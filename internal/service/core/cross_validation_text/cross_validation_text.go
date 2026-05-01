package cross_validation_text

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"github.com/yihaoye/infoverify/internal/service/core/skill"
)

// Skill evaluates cross-validation likelihood purely from the provided text
// (no DB search, no network crawling).
//
// Heuristic:
// - Count distinct referenced source domains (URLs) inside the text.
// - Give a small boost if the text explicitly signals sourcing ("according to", "来源", etc.).
type Skill struct{}

func (Skill) Name() string    { return "cross_validation_text" }
func (Skill) Weight() float64 { return 0.3 }

var urlRe = regexp.MustCompile(`https?://[^\s)>\]"}]+`)

func (Skill) Evaluate(_ context.Context, in skill.Input) (skill.Result, error) {
	content := strings.TrimSpace(in.Article.Content)
	if content == "" {
		return skill.Result{
			Skill:   "cross_validation_text",
			Weight:  0.3,
			Score:   0,
			Summary: "empty content",
		}, nil
	}

	domains := extractDomains(content)
	domainCount := len(domains)

	score := scoreByDomainCount(domainCount)
	if hasExplicitSourcing(content) {
		score = clamp(score+0.05, 0, 1)
	}

	return skill.Result{
		Skill:   "cross_validation_text",
		Weight:  0.3,
		Score:   score,
		Summary: fmt.Sprintf("domains=%d", domainCount),
		Evidence: []skill.Evidence{
			{Type: "metric", Source: "referenced_domains", Excerpt: fmt.Sprintf("%d", domainCount)},
		},
	}, nil
}

func extractDomains(text string) map[string]struct{} {
	matches := urlRe.FindAllString(text, -1)
	out := make(map[string]struct{})
	for _, m := range matches {
		u, err := url.Parse(m)
		if err != nil {
			continue
		}
		host := strings.ToLower(strings.TrimSpace(u.Host))
		if host == "" {
			continue
		}
		out[host] = struct{}{}
	}
	return out
}

func hasExplicitSourcing(text string) bool {
	l := strings.ToLower(text)
	// Keep this conservative to avoid over-scoring casual phrasing.
	signals := []string{
		"according to",
		"source:",
		"sources:",
		"来源",
		"据",
		"根据",
		"引用",
	}
	for _, s := range signals {
		if strings.Contains(l, s) || strings.Contains(text, s) {
			return true
		}
	}
	return false
}

func scoreByDomainCount(n int) float64 {
	switch {
	case n >= 3:
		return 0.8
	case n == 2:
		return 0.6
	case n == 1:
		return 0.3
	default:
		return 0.1
	}
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
