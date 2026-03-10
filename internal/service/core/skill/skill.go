package skill

import "context"

type Skill interface {
	Name() string
	Weight() float64
	Evaluate(ctx context.Context, in Input) (Result, error)
}
