package reproducible

import (
	"context"
	"fmt"

	"github.com/yihaoye/infoverify/internal/service/core/skill"
)

// Skill evaluates reproducibility likelihood.
type Skill struct{}

func (Skill) Name() string  { return "reproducibility" }
func (Skill) Weight() float64 { return 0.3 }

func (Skill) Evaluate(_ context.Context, in skill.Input) (skill.Result, error) {
	content := in.Article.Content
	url := in.Article.URL
	if content == "" {
		return skill.Result{
			Score:   0,
			Summary: "empty content",
		}, nil
	}

	length := len([]rune(content))
	lengthScore := clamp(float64(length)/3000.0, 0, 1)
	urlScore := 0.0
	if url != "" {
		urlScore = 1.0
	}

	score := lengthScore*0.6 + urlScore*0.4
	return skill.Result{
		Score:   score,
		Summary: fmt.Sprintf("len=%d url=%t", length, url != ""),
		Evidence: []skill.Evidence{
			{Type: "metric", Source: "content_length", Excerpt: fmt.Sprintf("%d", length)},
			{Type: "signal", Source: "has_url", Excerpt: fmt.Sprintf("%t", url != "")},
		},
	}, nil
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
