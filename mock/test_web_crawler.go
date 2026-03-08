package main

import (
	"fmt"
	"log"
	"net/url"

	"github.com/yihaoye/infoverify/service/support/web_crawler"
)

func main() {
	testURL := "https://go.dev/doc/effective_go" // 替换为你想要测试的公开文章 URL

	// 从 testURL 中解析出域名，作为 AllowedDomains
	parsedURL, err := url.Parse(testURL)
	if err != nil {
		log.Fatalf("Failed to parse test URL: %v", err)
	}
	allowedDomains := []string{parsedURL.Host}

	// 使用 NewWebCrawler 函数初始化 WebCrawler 实例
	crawler := web_crawler.NewWebCrawler(allowedDomains)

	fmt.Printf("Attempting to crawl: %s\n", testURL)

	article, err := crawler.Crawl(testURL)
	if err != nil {
		log.Fatalf("Error crawling %s: %v", testURL, err)
	}

	fmt.Printf("\n--- Crawl Results ---\n")
	fmt.Printf("URL: %s\n", article.URL)
	fmt.Printf("Title: %s\n", article.Title)
	fmt.Printf("Content Length: %d characters\n", len(article.Content))
	// fmt.Printf("Content:\n%s\n", article.Content) // 可以取消注释查看完整内容
}
