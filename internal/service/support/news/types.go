package news

import "time"

type Item struct {
	Title       string    `json:"title"`
	URL         string    `json:"url"`
	Source      string    `json:"source,omitempty"`
	PublishedAt time.Time `json:"published_at,omitempty"`
	Snippet     string    `json:"snippet,omitempty"`
	Provider    string    `json:"provider,omitempty"` // gdelt|sec
}

type SearchRequest struct {
	// Query follows provider syntax. For GDELT it is the raw "query=" string.
	Query string

	// Timespan is a GDELT-style timespan like "1d", "24h", "1week".
	// If empty, defaults to "24h".
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
