package dikw

import (
	"context"
	"fmt"
	"unicode"

	"github.com/yihaoye/infoverify/internal/service/core/skill"
)

// Skill evaluates detail richness (data, evidence, quantification).
type Skill struct{}

func (Skill) Name() string    { return "detail_richness" }
func (Skill) Weight() float64 { return 0.4 }

func (Skill) Evaluate(_ context.Context, in skill.Input) (skill.Result, error) {
	// 通过长度、数字密度、标点密度做粗略“细节丰富度”评分。
	content := in.Article.Content
	if content == "" {
		return skill.Result{
			Score:   0,
			Summary: "empty content",
		}, nil
	}

	length := len([]rune(content))
	digitCount := countDigits(content)
	punctCount := countPunct(content)

	// 简化打分：长度、数字、标点分别归一化。
	lengthScore := clamp(float64(length)/2000.0, 0, 1)
	digitScore := clamp(float64(digitCount)/20.0, 0, 1)
	punctScore := clamp(float64(punctCount)/50.0, 0, 1)

	score := (lengthScore*0.5 + digitScore*0.3 + punctScore*0.2)
	return skill.Result{
		Score:   score,
		Summary: fmt.Sprintf("len=%d digits=%d punct=%d", length, digitCount, punctCount),
		Evidence: []skill.Evidence{
			{Type: "metric", Source: "content_length", Excerpt: fmt.Sprintf("%d", length)},
			{Type: "metric", Source: "digit_count", Excerpt: fmt.Sprintf("%d", digitCount)},
		},
	}, nil
}

func countDigits(s string) int {
	n := 0
	for _, r := range s {
		if unicode.IsDigit(r) {
			n++
		}
	}
	return n
}

func countPunct(s string) int {
	n := 0
	for _, r := range s {
		if unicode.IsPunct(r) {
			n++
		}
	}
	return n
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
