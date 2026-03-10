package model

// Article represents a crawled article
type Article struct {
	ID      string `json:"id,omitempty"`
	URL     string `json:"url,omitempty"`
	Title   string `json:"title"`
	Content string `json:"content"`
	Author  string `json:"author,omitempty"`
}
