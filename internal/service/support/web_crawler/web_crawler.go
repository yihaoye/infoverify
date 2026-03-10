package web_crawler

import (
	"log"

	"github.com/gocolly/colly/v2"
	"github.com/yihaoye/infoverify/internal/model"
)

type WebCrawler struct {
	collector *colly.Collector
}

func NewWebCrawler(domains []string) *WebCrawler {
	c := colly.NewCollector(
		colly.AllowedDomains(domains...),
	)

	return &WebCrawler{
		collector: c,
	}
}

func (wc *WebCrawler) Crawl(url string) (*model.Article, error) {
	article := &model.Article{}
	var body string

	wc.collector.OnHTML("h1", func(e *colly.HTMLElement) {
		article.Title = e.Text
	})

	wc.collector.OnHTML("p", func(e *colly.HTMLElement) {
		body += e.Text + "\n"
	})

	wc.collector.OnRequest(func(r *colly.Request) {
		log.Println("Visiting", r.URL.String())
	})

	err := wc.collector.Visit(url)
	if err != nil {
		return nil, err
	}

	article.Content = body
	article.URL = url

	return article, nil
}
