package market

import (
	"regexp"
	"strings"
	"unicode"
)

var (
	tickerRe = regexp.MustCompile(`\b\$?[A-Z]{1,5}\b`)
	numRe    = regexp.MustCompile(`\b\d+(?:,\d{3})*(?:\.\d+)?%?\b`)
	dateRe   = regexp.MustCompile(`\b(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b`)
)

var financialKeywords = []string{
	"earnings", "revenue", "guidance", "eps", "adjusted", "profit", "loss",
	"quarter", "fiscal", "shares", "buyback", "dividend", "sec", "8-k", "10-q", "10-k",
	"press release", "investor relations", "outlook", "price target", "raises", "cuts",
}

var sourceCueKeywords = []string{
	"according to", "reported", "announced", "filed", "said", "revised",
	"sec", "press release", "investor relations", "earnings call", "8-k", "10-q", "10-k",
}

func BuildQuery(title, content string) string {
	title = NormalizeText(title)
	if title != "" {
		return title
	}
	content = NormalizeText(content)
	runes := []rune(content)
	if len(runes) > 180 {
		return string(runes[:180])
	}
	return content
}

func NormalizeText(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	fields := strings.FieldsFunc(s, func(r rune) bool {
		return unicode.IsSpace(r)
	})
	return strings.Join(fields, " ")
}

func ExtractTickers(text string) []string {
	text = strings.ToUpper(text)
	seen := make(map[string]struct{})
	out := make([]string, 0, 4)
	for _, m := range tickerRe.FindAllString(text, -1) {
		candidate := strings.TrimPrefix(m, "$")
		if len(candidate) < 2 || len(candidate) > 5 {
			continue
		}
		if _, ok := seen[candidate]; ok {
			continue
		}
		if isProbableTicker(candidate) {
			seen[candidate] = struct{}{}
			out = append(out, candidate)
		}
	}
	return out
}

func HasFinancialKeywords(text string) bool {
	l := strings.ToLower(text)
	for _, kw := range financialKeywords {
		if strings.Contains(l, kw) {
			return true
		}
	}
	return false
}

func HasSourceCues(text string) bool {
	l := strings.ToLower(text)
	for _, kw := range sourceCueKeywords {
		if strings.Contains(l, kw) {
			return true
		}
	}
	return false
}

func NumericSignalCount(text string) int {
	count := len(numRe.FindAllString(text, -1))
	count += len(dateRe.FindAllString(text, -1))
	return count
}

func ScoreReproducibilitySignals(text, url string) float64 {
	score := 0.0
	if strings.TrimSpace(url) != "" {
		score += 0.22
	}
	if HasFinancialKeywords(text) {
		score += 0.18
	}
	if HasSourceCues(text) {
		score += 0.22
	}
	if NumericSignalCount(text) > 0 {
		score += 0.18
	}
	if len(ExtractTickers(text)) > 0 {
		score += 0.12
	}
	length := len([]rune(text))
	switch {
	case length >= 1000:
		score += 0.08
	case length >= 400:
		score += 0.05
	case length >= 120:
		score += 0.02
	}
	if score > 1 {
		score = 1
	}
	return score
}

func isProbableTicker(candidate string) bool {
	if len(candidate) < 2 || len(candidate) > 5 {
		return false
	}
	// Avoid a few common false positives.
	switch candidate {
	case "THE", "AND", "FOR", "ARE", "ALL", "NOT", "YOU", "BUT", "NEW":
		return false
	}
	return true
}

