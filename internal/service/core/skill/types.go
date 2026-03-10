package skill

import "github.com/yihaoye/infoverify/internal/model"

type Evidence struct {
	Type    string `json:"type"`
	Source  string `json:"source"`
	Excerpt string `json:"excerpt,omitempty"`
	URL     string `json:"url,omitempty"`
}

type Result struct {
	Skill    string     `json:"skill"`
	Score    float64    `json:"score"`
	Weight   float64    `json:"weight"`
	Summary  string     `json:"summary"`
	Evidence []Evidence `json:"evidence,omitempty"`
}

type Report struct {
	Article      model.Article `json:"article"`
	OverallScore float64       `json:"overall_score"`
	Results      []Result      `json:"results"`
}

type Input struct {
	Article model.Article
}
