package reproducible

import (
	"context"
	"fmt"
	"strings"

	"github.com/yihaoye/infoverify/internal/service/core/skill"
	"github.com/yihaoye/infoverify/internal/service/support/market"
)

// Skill evaluates how easy it is to reproduce the claim from public financial sources.
type Skill struct{}

func (Skill) Name() string    { return "reproducibility" }
func (Skill) Weight() float64 { return 0.3 }

func (Skill) Evaluate(_ context.Context, in skill.Input) (skill.Result, error) {
	text := in.Article.Title + " " + in.Article.Content
	url := in.Article.URL

	if strings.TrimSpace(text) == "" {
		return skill.Result{
			Skill:   "reproducibility",
			Weight:  0.3,
			Score:   0,
			Summary: "empty content",
		}, nil
	}

	baseScore := market.ScoreReproducibilitySignals(text, url)
	sources := make([]skill.Evidence, 0, 4)

	if url != "" {
		sources = append(sources, skill.Evidence{
			Type:    "signal",
			Source:  "url",
			Excerpt: url,
			URL:     url,
		})
	}

	if tickers := market.ExtractTickers(text); len(tickers) > 0 {
		sources = append(sources, skill.Evidence{
			Type:    "signal",
			Source:  "ticker",
			Excerpt: tickers[0],
		})
	}

	if n := market.NumericSignalCount(text); n > 0 {
		sources = append(sources, skill.Evidence{
			Type:    "metric",
			Source:  "numeric_signals",
			Excerpt: fmt.Sprintf("%d", n),
		})
	}

	if market.HasSourceCues(text) {
		sources = append(sources, skill.Evidence{
			Type:    "signal",
			Source:  "source_cues",
			Excerpt: "yes",
		})
	}

	return skill.Result{
		Skill:    "reproducibility",
		Weight:   0.3,
		Score:    baseScore,
		Summary:  fmt.Sprintf("score=%.2f url=%t", baseScore, url != ""),
		Evidence: sources,
	}, nil
}
