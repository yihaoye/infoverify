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

type crossrefResponse struct {
	Message struct {
		Items []struct {
			DOI   string   `json:"DOI"`
			URL   string   `json:"URL"`
			Title []string `json:"title"`
		} `json:"items"`
	} `json:"message"`
}

// SearchCrossref searches works via Crossref REST API.
func SearchCrossref(ctx context.Context, query string, limit int) ([]SearchResult, error) {
	if limit <= 0 {
		limit = 5
	}
	base := "https://api.crossref.org/works"
	params := url.Values{}
	params.Set("query", query)
	params.Set("rows", strconv.Itoa(limit))
	if mail := os.Getenv("CROSSREF_MAILTO"); mail != "" {
		params.Set("mailto", mail)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"?"+params.Encode(), nil)
	if err != nil {
		return nil, fmt.Errorf("crossref request: %w", err)
	}
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("crossref call: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("crossref http status: %s", resp.Status)
	}

	var data crossrefResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, fmt.Errorf("crossref decode: %w", err)
	}

	results := make([]SearchResult, 0, len(data.Message.Items))
	for _, item := range data.Message.Items {
		title := ""
		if len(item.Title) > 0 {
			title = item.Title[0]
		}
		url := item.URL
		if url == "" && item.DOI != "" {
			url = "https://doi.org/" + item.DOI
		}
		results = append(results, SearchResult{
			Title:  title,
			URL:    url,
			Source: "crossref",
		})
	}
	return results, nil
}
