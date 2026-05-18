package cross_validation

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/yihaoye/infoverify/internal/service/core/skill"
	"github.com/yihaoye/infoverify/internal/service/support/external"
	"github.com/yihaoye/infoverify/internal/service/support/market"
	"github.com/yihaoye/infoverify/internal/service/support/news"
)

// Skill evaluates cross-validation for financial-market claims by comparing:
// - the current source, if any
// - recent market/news coverage
// - authoritative SEC filings when a ticker is available
type Skill struct{}

func (Skill) Name() string    { return "cross_validation" }
func (Skill) Weight() float64 { return 0.3 }

func (Skill) Evaluate(ctx context.Context, in skill.Input) (skill.Result, error) {
	mode := strings.ToLower(strings.TrimSpace(os.Getenv("CROSS_VALIDATE_MODE")))
	if mode == "" {
		mode = "market"
	}

	result := skill.Result{
		Skill:  "cross_validation",
		Weight: 0.3,
	}

	switch mode {
	case "market":
		return evaluateMarket(ctx, in, result)
	default:
		result.Score = 0
		result.Summary = "invalid CROSS_VALIDATE_MODE"
		return result, nil
	}
}

func evaluateMarket(ctx context.Context, in skill.Input, result skill.Result) (skill.Result, error) {
	query := market.BuildQuery(in.Article.Title, in.Article.Content)
	if query == "" {
		query = market.BuildQuery("", in.Article.URL)
	}
	ticker := firstTicker(market.ExtractTickers(in.Article.Title + " " + in.Article.Content + " " + in.Article.URL))
	timespan := "7d"
	if ticker == "" {
		timespan = "3d"
	}

	items, err := news.Search(ctx, news.SearchRequest{
		Query:      query,
		Timespan:   timespan,
		MaxRecords: 8,
		Ticker:     ticker,
	})
	if err != nil {
		result.Score = 0
		result.Summary = "market search failed: " + err.Error()
		return result, nil
	}

	newsHits := 0
	secHits := 0
	uniqueHosts := make(map[string]struct{})
	for _, item := range items.Items {
		newsHits++
		if item.Provider == "sec" {
			secHits++
		}
		if host := hostFromURL(item.URL); host != "" {
			uniqueHosts[host] = struct{}{}
		}
	}

	searchScore := scoreSearchEvidence(newsHits, len(uniqueHosts), secHits)
	searchEvidence := make([]skill.Evidence, 0, 4)
	for i, item := range items.Items {
		if i >= 3 {
			break
		}
		searchEvidence = append(searchEvidence, skill.Evidence{
			Type:    item.Provider,
			Source:  item.Title,
			URL:     item.URL,
			Excerpt: item.Snippet,
		})
	}

	recrawlScore, recrawlEvidence := 0.0, []skill.Evidence(nil)
	if in.Article.URL != "" {
		if parsed, err := url.Parse(in.Article.URL); err == nil && parsed.Host != "" {
			page, err := external.FetchURLUnrestricted(ctx, in.Article.URL)
			if err == nil && page != nil {
				recrawlScore = scoreRecrawlConsistency(in, *page)
				recrawlEvidence = []skill.Evidence{
					{
						Type:    "source",
						Source:  page.Title,
						URL:     page.URL,
						Excerpt: excerpt(page.Content, 180),
					},
				}
			}
		}
	}

	score := clamp(searchScore*0.7+recrawlScore*0.3, 0, 1)
	if items.Warning != "" {
		score = clamp(score-0.05, 0, 1)
	}

	result.Score = score
	result.Summary = fmt.Sprintf("market hits=%d sec=%d recrawl=%.2f", newsHits, secHits, recrawlScore)
	result.Evidence = append(searchEvidence, recrawlEvidence...)
	return result, nil
}

func scoreSearchEvidence(newsHits, hostCount, secHits int) float64 {
	score := 0.0
	switch {
	case newsHits >= 6:
		score += 0.45
	case newsHits >= 4:
		score += 0.35
	case newsHits >= 2:
		score += 0.22
	case newsHits == 1:
		score += 0.12
	default:
		score += 0.02
	}

	switch {
	case hostCount >= 4:
		score += 0.25
	case hostCount >= 3:
		score += 0.18
	case hostCount >= 2:
		score += 0.12
	}

	if secHits > 0 {
		score += 0.25
	}
	return clamp(score, 0, 1)
}

func scoreRecrawlConsistencyArticle(articleTitle, articleContent string, pageTitle, pageContent string) float64 {
	score := 0.0
	articleTitleNorm := normalizeForCompare(articleTitle)
	pageTitleNorm := normalizeForCompare(pageTitle)
	if articleTitleNorm != "" && strings.Contains(pageTitleNorm, articleTitleNorm) {
		score += 0.45
	}
	articleNorm := normalizeForCompare(articleContent)
	pageNorm := normalizeForCompare(pageContent)
	if articleNorm != "" && pageNorm != "" {
		score += tokenOverlapRatio(articleNorm, pageNorm) * 0.45
	}
	if score == 0 && pageContent != "" {
		score = 0.15
	}
	return clamp(score, 0, 1)
}

func scoreRecrawlConsistency(article skill.Input, page external.FetchedPage) float64 {
	return scoreRecrawlConsistencyArticle(article.Article.Title, article.Article.Content, page.Title, page.Content)
}

func hostFromURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(parsed.Host))
}

func firstTicker(tickers []string) string {
	if len(tickers) == 0 {
		return ""
	}
	return tickers[0]
}

func normalizeForCompare(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	fields := strings.FieldsFunc(s, func(r rune) bool {
		return r == ' ' || r == '\n' || r == '\t' || r == '\r' || r == ',' || r == '.' || r == ':' || r == ';' || r == '(' || r == ')' || r == '[' || r == ']' || r == '"' || r == '\''
	})
	return strings.Join(fields, " ")
}

func tokenOverlapRatio(a, b string) float64 {
	if a == "" || b == "" {
		return 0
	}
	aTokens := strings.Fields(a)
	bTokens := strings.Fields(b)
	if len(aTokens) == 0 || len(bTokens) == 0 {
		return 0
	}
	setA := make(map[string]struct{}, len(aTokens))
	for _, token := range aTokens {
		setA[token] = struct{}{}
	}
	shared := 0
	for _, token := range bTokens {
		if _, ok := setA[token]; ok {
			shared++
		}
	}
	shorter := len(aTokens)
	if len(bTokens) < shorter {
		shorter = len(bTokens)
	}
	if shorter == 0 {
		return 0
	}
	return float64(shared) / float64(shorter)
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func excerpt(s string, max int) string {
	if max <= 0 || s == "" {
		return ""
	}
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}
