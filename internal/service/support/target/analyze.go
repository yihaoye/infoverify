package target

import (
	"context"

	"github.com/yihaoye/infoverify/internal/model"
	"github.com/yihaoye/infoverify/internal/service/core/agent"
	"github.com/yihaoye/infoverify/internal/service/core/skill"
)

func AnalyzeArticle(ctx context.Context, article model.Article) (skill.Report, error) {
	// 调用 LLM 总控进行分析。
	return agent.RunLLMController(ctx, article)
}
