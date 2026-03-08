package model

// Article represents a crawled article
type Article struct {
	URL     string `json:"url"`
	Title   string `json:"title"`
	Content string `json:"content"`
}
