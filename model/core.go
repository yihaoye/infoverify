package model

type TextConclusion struct {
	ID     string `json:"id"`
	TextID string `json:"text_id"`

	Explain string `json:"explain"`
	// Compare               string  `json:"compare"` // how avg, top10 etc looks like
	CrossValidationScore  float64 `json:"cross_validation_score"`
	CrossValidationWeight float64 `json:"cross_validation_weight"`
	DIWKScore             float64 `json:"dikw_score"`
	DIWKWeight            float64 `json:"dikw_weight"`
	ReproducibleScore     float64 `json:"reproducible_score"`
	ReproducibleWeight    float64 `json:"reproducible_weight"`

	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

func (c *TextConclusion) SumScore() float64 {
	res := 0.0
	res += c.CrossValidationScore * c.CrossValidationWeight
	res += c.DIWKScore * c.DIWKWeight
	res += c.ReproducibleScore * c.ReproducibleWeight
	return res
}

type Text struct {
	ID        string       `json:"id"`
	Source    TargetSource `json:"source"`
	Language  string       `json:"language"`
	Content   string       `json:"content"` // or Data
	ViewCount int64        `json:"view_count"`
}

type TargetSource int

const (
	SourceUnknown     TargetSource = 0
	SourceURL         TargetSource = 1
	SourceDirectInput TargetSource = 2
)
