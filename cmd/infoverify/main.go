package main

import (
	"flag"
	"log"
	"net/http"
	"net/url"

	"github.com/yihaoye/infoverify/internal/dal"
	"github.com/yihaoye/infoverify/internal/dal/redis"
	"github.com/yihaoye/infoverify/internal/server"
	"github.com/yihaoye/infoverify/internal/service/support/target"
	"github.com/yihaoye/infoverify/internal/service/support/web_crawler"
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
	case "server": // 请求-响应模式（HTTP 服务）
		runServer()
	case "worker": // 后台任务模式（抓取与分析）
		runWorker()
	default:
		log.Fatal("Unknown mode")
	}
}

func runServer() {
	dal.Init()
	defer dal.Stop()

	// 路由注册并启动 HTTP 服务。
	server.SetupRoutes()
	log.Println("Server started on", port)
	log.Fatal(http.ListenAndServe(port, nil))
}

func runWorker() {
	dal.Init()
	defer dal.Stop()

	log.Println("Worker started. Waiting for tasks from the queue...")

	for {
		// 从 Redis 队列阻塞获取任务。
		result, err := redis.Rdb.BRPop(redis.Ctx, 0, target.CrawlTaskQueueKey).Result()
		if err != nil {
			log.Printf("Error popping task from Redis: %v. Retrying...", err)
			continue
		}

		taskURL := result[1]
		log.Printf("Received task: Crawl %s", taskURL)

		// 解析 URL 并开始抓取。
		parsedURL, err := url.Parse(taskURL)
		if err != nil {
			log.Printf("Invalid URL received: %s. Skipping.", taskURL)
			continue
		}
		taskID := target.IDFromURL(taskURL)
		_ = target.UpdateTaskStatus(taskID, "crawling", "")

		crawler := web_crawler.NewWebCrawler([]string{parsedURL.Host})

		// 抓取正文并入库。
		article, err := crawler.Crawl(taskURL)
		if err != nil {
			log.Printf("Failed to crawl %s: %v", taskURL, err)
			_ = target.UpdateTaskStatus(taskID, "failed", err.Error())
			continue
		}

		log.Printf("Successfully crawled: %s", article.Title)

		docID, err := target.SaveArticle(*article)
		if err != nil {
			log.Printf("Failed to store article %s: %v", article.URL, err)
			_ = target.UpdateTaskStatus(taskID, "failed", err.Error())
			continue
		}
		log.Printf("Successfully stored article %s with ID %s", article.URL, docID)
		_ = target.UpdateTaskStatus(taskID, "indexed", "")

		// 分析并保存报告。
		_ = target.UpdateTaskStatus(taskID, "analyzing", "")
		if report, err := target.AnalyzeArticle(redis.Ctx, *article); err == nil {
			_ = target.SaveReport(docID, report)
			_ = target.UpdateTaskStatus(taskID, "analyzed", "")
		} else {
			log.Printf("Failed to analyze article %s: %v", article.URL, err)
			_ = target.UpdateTaskStatus(taskID, "failed", err.Error())
		}
	}
}
