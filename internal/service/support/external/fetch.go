package external

import (
	"bufio"
	"context"
	"fmt"
	"net/url"
	"strings"

	"github.com/yihaoye/infoverify/internal/service/support/browser_rendering"
	"github.com/yihaoye/infoverify/internal/service/support/web_crawler"
)

type FetchedPage struct {
	URL     string `json:"url"`
	Title   string `json:"title"`
	Content string `json:"content"`
}

func FetchURL(ctx context.Context, rawURL string) (*FetchedPage, error) {
	// 统一抓取入口：优先 Cloudflare Browser Rendering，失败则回退本地爬虫。
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("invalid url: %w", err)
	}
	if !IsAllowedHost(parsed.Host) {
		return nil, fmt.Errorf("host not allowed: %s", parsed.Host)
	}

	if browser_rendering.Configured() {
		// BR 返回 Markdown，适合下游抽取与 LLM 使用。
		md, err := browser_rendering.FetchMarkdown(ctx, rawURL)
		if err == nil && md != "" {
			title := titleFromMarkdown(md)
			return &FetchedPage{URL: rawURL, Title: title, Content: md}, nil
		}
	}

	crawler := web_crawler.NewWebCrawler([]string{parsed.Host})
	article, err := crawler.Crawl(rawURL)
	if err != nil {
		return nil, err
	}
	return &FetchedPage{URL: article.URL, Title: article.Title, Content: article.Content}, nil
}

func titleFromMarkdown(md string) string {
	// 简易标题抽取：取首个 "# " 行。
	scanner := bufio.NewScanner(strings.NewReader(md))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "# ") {
			return strings.TrimSpace(strings.TrimPrefix(line, "# "))
		}
	}
	return ""
}
