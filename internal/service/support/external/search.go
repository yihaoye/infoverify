package external

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"time"
)

type SearchResult struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet,omitempty"`
	Source  string `json:"source,omitempty"`
}

type searchResponse struct {
	Items []SearchResult `json:"items"`
}

// Search uses an external search API. Requires SEARCH_API_URL and SEARCH_API_KEY.
func Search(ctx context.Context, query string, limit int) ([]SearchResult, error) {
	apiURL := os.Getenv("SEARCH_API_URL")
	apiKey := os.Getenv("SEARCH_API_KEY")
	if apiURL == "" || apiKey == "" {
		return nil, errors.New("external search not configured")
	}
	if limit <= 0 {
		limit = 5
	}

	payload := map[string]interface{}{
		"q":     query,
		"limit": limit,
	}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL, bytesReader(body))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("search request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("search http status: %s", resp.Status)
	}

	var data searchResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, fmt.Errorf("decode search: %w", err)
	}

	return data.Items, nil
}

func bytesReader(b []byte) *bytes.Reader { return bytes.NewReader(b) }

func SearchWithSite(ctx context.Context, query, site string, limit int) ([]SearchResult, error) {
	if site != "" {
		query = fmt.Sprintf("%s site:%s", query, site)
	}
	return Search(ctx, query, limit)
}
