package cross_validation

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/yihaoye/infoverify/internal/service/core/skill"
	"github.com/yihaoye/infoverify/internal/service/support/search"
	"github.com/yihaoye/infoverify/internal/service/support/web_crawler"
)

// Skill evaluates cross-validation.
type Skill struct{}

func (Skill) Name() string  { return "cross_validation" }
func (Skill) Weight() float64 { return 0.3 }

func (Skill) Evaluate(ctx context.Context, in skill.Input) (skill.Result, error) {
	mode := strings.ToLower(strings.TrimSpace(os.Getenv("CROSS_VALIDATE_MODE")))
	if mode == "" {
		mode = "local"
	}

	result := skill.Result{
		Skill:  "cross_validation",
		Weight: 0.3,
	}

	switch mode {
	case "local":
		query := buildQuery(in.Article.Title, in.Article.Content)
		articles, err := search.SearchArticles(ctx, query, 5)
		if err != nil {
			result.Score = 0
			result.Summary = "local search failed"
			return result, nil
		}
		count := len(articles)
		result.Score = scoreByCount(count)
		result.Summary = fmt.Sprintf("local hits=%d", count)
		if count > 0 {
			result.Evidence = []skill.Evidence{
				{Type: "metric", Source: "local_hits", Excerpt: fmt.Sprintf("%d", count)},
			}
		}
		return result, nil
	case "web":
		// Only recrawl the same URL for consistency check.
		if in.Article.URL == "" {
			result.Score = 0
			result.Summary = "web mode: no url"
			return result, nil
		}
		parsed, err := url.Parse(in.Article.URL)
		if err != nil {
			result.Score = 0
			result.Summary = "web mode: invalid url"
			return result, nil
		}
		crawler := web_crawler.NewWebCrawler([]string{parsed.Host})
		article, err := crawler.Crawl(in.Article.URL)
		if err != nil {
			result.Score = 0
			result.Summary = "web mode: crawl failed"
			return result, nil
		}
		consistent := 0
		if article.Title == in.Article.Title {
			consistent++
		}
		if len(article.Content) > 0 && len(in.Article.Content) > 0 {
			consistent++
		}
		result.Score = float64(consistent) / 2.0
		result.Summary = fmt.Sprintf("web recrawl consistency=%d/2", consistent)
		return result, nil
	default:
		result.Score = 0
		result.Summary = "invalid CROSS_VALIDATE_MODE"
		return result, nil
	}
}

func buildQuery(title, content string) string {
	title = strings.TrimSpace(title)
	if title != "" {
		return title
	}
	content = strings.TrimSpace(content)
	if len(content) > 200 {
		content = content[:200]
	}
	return content
}

func scoreByCount(count int) float64 {
	switch {
	case count >= 3:
		return 0.8
	case count == 2:
		return 0.6
	case count == 1:
		return 0.3
	default:
		return 0.1
	}
}
