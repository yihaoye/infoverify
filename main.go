package main

import (
	"flag"
	"log"
	"net/http"
	"net/url"

	"github.com/yihaoye/infoverify/dal"
	"github.com/yihaoye/infoverify/dal/kv"
	"github.com/yihaoye/infoverify/dal/semantics_search"
	"github.com/yihaoye/infoverify/server"
	"github.com/yihaoye/infoverify/service/support/target"
	"github.com/yihaoye/infoverify/service/support/web_crawler"
)

const (
	port = ":8080"
)

var (
	task = flag.String("task", "", "The name of the task")
	mode = flag.String("mode", "server", "The name of the web server")
)

func main() {
	flag.Parse()

	switch *mode {
	case "server": // request-respond pattern
		runServer()
	case "event", "stream": // event-driven pattern, mainly for web crawler
		runWorker()
	default:
		log.Fatal("Unknown mode")
	}
}

func runServer() {
	dal.Init()
	defer dal.Stop()

	server.SetupRoutes()
	log.Println("Server started on", port)
	log.Fatal(http.ListenAndServe(port, nil))
}

func runWorker() {
	dal.Init()
	defer dal.Stop()

		log.Println("Worker started. Waiting for tasks from the queue...")

	for {
		// Blocking Pop from the Redis list (queue)
		result, err := kv.Rdb.BRPop(kv.Ctx, 0, target.CrawlTaskQueueKey).Result()
		if err != nil {
			log.Printf("Error popping task from Redis: %v. Retrying...", err)
			continue
		}

		taskURL := result[1]
		log.Printf("Received task: Crawl %s", taskURL)

		parsedURL, err := url.Parse(taskURL)
		if err != nil {
			log.Printf("Invalid URL received: %s. Skipping.", taskURL)
			continue
		}
		crawler := web_crawler.NewWebCrawler([]string{parsedURL.Host})

		article, err := crawler.Crawl(taskURL)
		if err != nil {
			log.Printf("Failed to crawl %s: %v", taskURL, err)
			continue
		}

		log.Printf("Successfully crawled: %s", article.Title)
		
		// Index the article into Elasticsearch
		docID, err := semantics_search.ArticleESClient.IndexArticle(*article)
		if err != nil {
			log.Printf("Failed to index article %s: %v", article.URL, err)
			continue
		}
		log.Printf("Successfully indexed article %s with ID %s", article.URL, docID)
	}
}
