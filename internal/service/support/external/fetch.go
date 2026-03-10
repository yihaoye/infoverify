package external

import (
	"fmt"
	"net/url"

	"github.com/yihaoye/infoverify/internal/service/support/web_crawler"
)

type FetchedPage struct {
	URL     string `json:"url"`
	Title   string `json:"title"`
	Content string `json:"content"`
}

func FetchURL(rawURL string) (*FetchedPage, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("invalid url: %w", err)
	}
	if !IsAllowedHost(parsed.Host) {
		return nil, fmt.Errorf("host not allowed: %s", parsed.Host)
	}

	crawler := web_crawler.NewWebCrawler([]string{parsed.Host})
	article, err := crawler.Crawl(rawURL)
	if err != nil {
		return nil, err
	}
	return &FetchedPage{URL: article.URL, Title: article.Title, Content: article.Content}, nil
}
