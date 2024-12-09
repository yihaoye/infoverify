package model

type Conclusion struct {
	ID       string `json:"id"`
	TargetID string `json:"target_id"`

	Explain               string  `json:"explain"`
	CrossValidationScore  float64 `json:"cross_validation_score"`
	CrossValidationWeight float64 `json:"cross_validation_weight"`
	DIWKScore             float64 `json:"dikw_score"`
	DIWKWeight            float64 `json:"dikw_weight"`
	ReproducibleScore     float64 `json:"reproducible_score"`
	ReproducibleWeight    float64 `json:"reproducible_weight"`

	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

func (c *Conclusion) SumScore() float64 {
	res := 0.0
	res += c.CrossValidationScore * c.CrossValidationWeight
	res += c.DIWKScore * c.DIWKWeight
	res += c.ReproducibleScore * c.ReproducibleWeight
	return res
}

type EventType int

const (
	Unknown EventType = 0
	Create  EventType = 1
	Update  EventType = 2
)

type Event struct {
	Type EventType `json:"type"`
}
