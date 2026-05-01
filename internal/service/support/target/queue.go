package target

import (
	"context"
	"fmt"
	"net/url"

	"github.com/yihaoye/infoverify/internal/dal/redis"
)

const CrawlTaskQueueKey = "infoverify:crawl_tasks"

func EnqueueCrawlTask(ctx context.Context, taskURL string) (string, error) {
	// 入队等待 Worker 抓取。
	if taskURL == "" {
		return "", fmt.Errorf("url is empty")
	}
	if _, err := url.ParseRequestURI(taskURL); err != nil {
		return "", fmt.Errorf("invalid url: %w", err)
	}
	if !redis.Ready() {
		return "", fmt.Errorf("redis not configured")
	}

	docID := IDFromURL(taskURL)
	_, _ = UpsertTask(docID, taskURL, "queued", "")
	if err := redis.Rdb.LPush(redis.Ctx, CrawlTaskQueueKey, taskURL).Err(); err != nil {
		return "", err
	}
	return docID, nil
}
