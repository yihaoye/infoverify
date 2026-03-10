package target

import (
	"context"

	"github.com/yihaoye/infoverify/internal/model"
	"github.com/yihaoye/infoverify/internal/service/core/agent"
	"github.com/yihaoye/infoverify/internal/service/core/skill"
)

func AnalyzeArticle(ctx context.Context, article model.Article) (skill.Report, error) {
	a := agent.New(agent.DefaultSkills(), nil)
	return a.Run(ctx, skill.Input{Article: article})
}
