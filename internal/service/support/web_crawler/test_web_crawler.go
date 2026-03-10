//go:build manual

package web_crawler

import (
	"net/url"
	"testing"
)

func TestManualCrawl(t *testing.T) {
	testURL := "https://go.dev/doc/effective_go"

	parsedURL, err := url.Parse(testURL)
	if err != nil {
		t.Fatalf("parse test url: %v", err)
	}
	allowedDomains := []string{parsedURL.Host}

	crawler := NewWebCrawler(allowedDomains)
	article, err := crawler.Crawl(testURL)
	if err != nil {
		t.Fatalf("crawl failed: %v", err)
	}

	if article.Title == "" || article.Content == "" {
		t.Fatalf("empty result: title=%q content_len=%d", article.Title, len(article.Content))
	}
}
