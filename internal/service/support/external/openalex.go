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

type openalexResponse struct {
	Results []struct {
		ID    string `json:"id"`
		DOI   string `json:"doi"`
		Title string `json:"title"`
	} `json:"results"`
}

// SearchOpenAlex searches works via OpenAlex API.
func SearchOpenAlex(ctx context.Context, query string, limit int) ([]SearchResult, error) {
	if limit <= 0 {
		limit = 5
	}
	base := "https://api.openalex.org/works"
	params := url.Values{}
	params.Set("search", query)
	params.Set("per-page", strconv.Itoa(limit))
	if key := os.Getenv("OPENALEX_API_KEY"); key != "" {
		params.Set("api_key", key)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"?"+params.Encode(), nil)
	if err != nil {
		return nil, fmt.Errorf("openalex request: %w", err)
	}
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("openalex call: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("openalex http status: %s", resp.Status)
	}

	var data openalexResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, fmt.Errorf("openalex decode: %w", err)
	}

	results := make([]SearchResult, 0, len(data.Results))
	for _, r := range data.Results {
		url := r.DOI
		if url == "" {
			url = r.ID
		}
		results = append(results, SearchResult{
			Title:  r.Title,
			URL:    url,
			Source: "openalex",
		})
	}
	return results, nil
}
