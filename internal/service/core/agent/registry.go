package agent

import (
	"github.com/yihaoye/infoverify/internal/service/core/cross_validation"
	"github.com/yihaoye/infoverify/internal/service/core/dikw"
	"github.com/yihaoye/infoverify/internal/service/core/reproducible"
	"github.com/yihaoye/infoverify/internal/service/core/skill"
)

func DefaultSkills() []skill.Skill {
	return []skill.Skill{
		dikw.Skill{},
		reproducible.Skill{},
		cross_validation.Skill{},
	}
}
