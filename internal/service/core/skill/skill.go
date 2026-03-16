package skill

import "context"

type Skill interface {
	// Name 返回技能名称。
	Name() string
	// Weight 返回该技能在总体评分中的权重。
	Weight() float64
	// Evaluate 执行技能评估。
	Evaluate(ctx context.Context, in Input) (Result, error)
}
