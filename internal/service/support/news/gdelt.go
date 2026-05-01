package news

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const gdeltBaseURL = "https://api.gdeltproject.org/api/v2/doc/doc"

type gdeltResponse struct {
	Articles []struct {
		URL      string `json:"url"`
		Title    string `json:"title"`
		Seendate string `json:"seendate"` // 20250430120000
		Domain   string `json:"domain"`
		Source   string `json:"sourceCountry"`
	} `json:"articles"`
}

func SearchGDELT(ctx context.Context, query, timespan string, maxRecords int) ([]Item, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, fmt.Errorf("query is empty")
	}
	if timespan == "" {
		timespan = "24h"
	}
	if maxRecords <= 0 {
		maxRecords = 10
	}
	if maxRecords > 250 {
		maxRecords = 250
	}

	params := url.Values{}
	params.Set("format", "json")
	params.Set("mode", "artlist")
	params.Set("sort", "datedesc")
	params.Set("maxrecords", strconv.Itoa(maxRecords))
	params.Set("timespan", timespan)
	params.Set("query", query)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, gdeltBaseURL+"?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("gdelt http status: %s", resp.Status)
	}

	var data gdeltResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}

	out := make([]Item, 0, len(data.Articles))
	for _, a := range data.Articles {
		if a.URL == "" || a.Title == "" {
			continue
		}
		out = append(out, Item{
			Title:       a.Title,
			URL:         a.URL,
			Source:      firstNonEmpty(a.Domain, a.Source),
			PublishedAt: parseGDELTSeenDate(a.Seendate),
			Provider:    "gdelt",
		})
	}
	return out, nil
}

func parseGDELTSeenDate(s string) time.Time {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}
	}
	// GDELT uses YYYYMMDDHHMMSS (UTC).
	t, err := time.ParseInLocation("20060102150405", s, time.UTC)
	if err != nil {
		return time.Time{}
	}
	return t
}

func firstNonEmpty(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return a
	}
	return b
}
