package news

import "time"

type Item struct {
	Title       string    `json:"title"`
	URL         string    `json:"url"`
	Source      string    `json:"source,omitempty"`
	PublishedAt time.Time `json:"published_at,omitempty"`
	Snippet     string    `json:"snippet,omitempty"`
	Provider    string    `json:"provider,omitempty"` // google_news|sec
}

type SearchRequest struct {
	// Query is a plain-language Google News search query.
	Query string

	// Timespan is an optional recent-news window such as "1d", "24h", or "7d".
	// If empty, it defaults to the previous day.
	Timespan string

	MaxRecords int

	// If set, SEC filings will be fetched for the ticker and included.
	Ticker string
}

type SearchResponse struct {
	Query   string `json:"query"`
	Items   []Item `json:"items"`
	Warning string `json:"warning,omitempty"`
}
