package agent

import (
	"context"

	"github.com/yihaoye/infoverify/internal/model"
	"github.com/yihaoye/infoverify/internal/service/core/skill"
)

type Agent struct {
	skills []skill.Skill
	policy Policy
}

func New(skills []skill.Skill, policy Policy) *Agent {
	if policy == nil {
		policy = DefaultPolicy{}
	}
	return &Agent{
		skills: skills,
		policy: policy,
	}
}

func (a *Agent) Run(ctx context.Context, in skill.Input) (skill.Report, error) {
	selected := a.policy.Select(in, a.skills)
	results := make([]skill.Result, 0, len(selected))
	var sumWeight float64
	var sumScore float64

	for _, s := range selected {
		res, err := s.Evaluate(ctx, in)
		if err != nil {
			// Keep skill-level failure isolated.
			res = skill.Result{
				Skill:   s.Name(),
				Score:   0,
				Weight:  s.Weight(),
				Summary: "skill failed: " + err.Error(),
			}
		}
		if res.Skill == "" {
			res.Skill = s.Name()
		}
		if res.Weight == 0 {
			res.Weight = s.Weight()
		}
		results = append(results, res)
		sumWeight += res.Weight
		sumScore += res.Score * res.Weight
	}

	overall := 0.0
	if sumWeight > 0 {
		overall = sumScore / sumWeight
	}

	return skill.Report{
		Article:      in.Article,
		OverallScore: overall,
		Results:      results,
	}, nil
}

type Policy interface {
	Select(in skill.Input, skills []skill.Skill) []skill.Skill
}

type DefaultPolicy struct{}

func (p DefaultPolicy) Select(_ skill.Input, skills []skill.Skill) []skill.Skill {
	return skills
}

// NewReport builds a report without running skills, useful for fixed pipelines.
func NewReport(article model.Article) skill.Report {
	return skill.Report{
		Article:      article,
		OverallScore: 0,
		Results:      []skill.Result{},
	}
}
