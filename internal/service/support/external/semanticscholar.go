package external

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"time"
)

type s2Response struct {
	Data []struct {
		Title    string `json:"title"`
		URL      string `json:"url"`
		Abstract string `json:"abstract"`
	} `json:"data"`
}

// SearchSemanticScholar searches papers via Semantic Scholar Graph API.
func SearchSemanticScholar(ctx context.Context, query string, limit int) ([]SearchResult, error) {
	if limit <= 0 {
		limit = 5
	}
	base := "https://api.semanticscholar.org/graph/v1/paper/search"
	params := url.Values{}
	params.Set("query", query)
	params.Set("limit", strconv.Itoa(limit))
	params.Set("fields", "title,url,abstract")

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"?"+params.Encode(), nil)
	if err != nil {
		return nil, fmt.Errorf("semanticscholar request: %w", err)
	}
	if key := os.Getenv("SEMANTIC_SCHOLAR_API_KEY"); key != "" {
		req.Header.Set("x-api-key", key)
	}
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("semanticscholar call: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("semanticscholar http status: %s", resp.Status)
	}

	var data s2Response
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, fmt.Errorf("semanticscholar decode: %w", err)
	}

	results := make([]SearchResult, 0, len(data.Data))
	for _, item := range data.Data {
		results = append(results, SearchResult{
			Title:   item.Title,
			URL:     item.URL,
			Snippet: item.Abstract,
			Source:  "semanticscholar",
		})
	}
	return results, nil
}
