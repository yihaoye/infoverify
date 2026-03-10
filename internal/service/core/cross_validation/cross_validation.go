package cross_validation

import (
	"context"

	"github.com/yihaoye/infoverify/internal/service/core/skill"
)

// Skill evaluates cross-validation. MVP: placeholder.
type Skill struct{}

func (Skill) Name() string  { return "cross_validation" }
func (Skill) Weight() float64 { return 0.3 }

func (Skill) Evaluate(_ context.Context, _ skill.Input) (skill.Result, error) {
	return skill.Result{
		Score:   0,
		Summary: "not implemented",
	}, nil
}
