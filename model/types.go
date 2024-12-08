package model

type Conclusion struct {
	ID   string `json:"id"`
	Text string `json:"text"`

	CrossValidationScore float64 `json:"cross_validation_score"`
	DIWKScore            float64 `json:"dikw_score"`
	ReproducibleScore    float64 `json:"reproducible_score"`

	Time string `json:"time"`
}

func (c *Conclusion) GetTime() string {
	return c.Time
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
