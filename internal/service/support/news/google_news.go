package news

import (
	"context"
	"encoding/xml"
	"fmt"
	"html"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const googleNewsRSSURL = "https://news.google.com/rss/search"

var htmlTagPattern = regexp.MustCompile(`<[^>]*>`)

type googleNewsRSSFeed struct {
	Channel struct {
		Items []googleNewsRSSItem `xml:"item"`
	} `xml:"channel"`
}

type googleNewsRSSItem struct {
	Title       string `xml:"title"`
	Link        string `xml:"link"`
	Description string `xml:"description"`
	PublishedAt string `xml:"pubDate"`
	Source      struct {
		Name string `xml:",chardata"`
		URL  string `xml:"url,attr"`
	} `xml:"source"`
}

func SearchGoogleNewsRSS(ctx context.Context, query, timespan string, maxRecords int) ([]Item, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, fmt.Errorf("query is empty")
	}
	if maxRecords <= 0 {
		maxRecords = 10
	}
	if maxRecords > 100 {
		maxRecords = 100
	}

	params := url.Values{}
	params.Set("q", withGoogleNewsRecency(query, timespan))
	params.Set("hl", "en-US")
	params.Set("gl", "US")
	params.Set("ceid", "US:en")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, googleNewsRSSURL+"?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("google news http status: %s", resp.Status)
	}

	var feed googleNewsRSSFeed
	if err := xml.NewDecoder(resp.Body).Decode(&feed); err != nil {
		return nil, fmt.Errorf("decode google news RSS: %w", err)
	}

	items := make([]Item, 0, min(maxRecords, len(feed.Channel.Items)))
	for _, entry := range feed.Channel.Items {
		if len(items) >= maxRecords {
			break
		}
		title := cleanGoogleNewsTitle(entry.Title)
		link := strings.TrimSpace(entry.Link)
		if title == "" || link == "" {
			continue
		}
		items = append(items, Item{
			Title:       title,
			URL:         link,
			Source:      googleNewsSource(entry),
			PublishedAt: parseGoogleNewsDate(entry.PublishedAt),
			Snippet:     cleanGoogleNewsSnippet(entry.Description),
			Provider:    "google_news",
		})
	}
	return items, nil
}

func withGoogleNewsRecency(query, timespan string) string {
	when := googleNewsWhen(timespan)
	if when == "" {
		return query
	}
	return query + " when:" + when
}

func googleNewsWhen(timespan string) string {
	switch strings.ToLower(strings.TrimSpace(timespan)) {
	case "", "24h", "1d":
		return "1d"
	case "1h", "6h", "12h", "2d", "3d", "7d", "30d":
		return strings.ToLower(strings.TrimSpace(timespan))
	case "1week", "1w":
		return "7d"
	default:
		return ""
	}
}

func googleNewsSource(entry googleNewsRSSItem) string {
	if source := strings.TrimSpace(entry.Source.Name); source != "" {
		return source
	}
	if sourceURL, err := url.Parse(strings.TrimSpace(entry.Source.URL)); err == nil && sourceURL.Hostname() != "" {
		return sourceURL.Hostname()
	}
	return "Google News"
}

func cleanGoogleNewsTitle(title string) string {
	title = strings.TrimSpace(title)
	if separator := strings.LastIndex(title, " - "); separator > 0 {
		return strings.TrimSpace(title[:separator])
	}
	return title
}

func cleanGoogleNewsSnippet(snippet string) string {
	plain := html.UnescapeString(snippet)
	plain = htmlTagPattern.ReplaceAllString(plain, " ")
	return strings.Join(strings.Fields(plain), " ")
}

func parseGoogleNewsDate(value string) time.Time {
	parsed, err := http.ParseTime(strings.TrimSpace(value))
	if err != nil {
		return time.Time{}
	}
	return parsed
}

func firstNonEmpty(first, second string) string {
	if strings.TrimSpace(first) != "" {
		return first
	}
	return second
}
