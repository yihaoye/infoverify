package target

import (
	"context"
	"fmt"
	"net/url"

	"github.com/yihaoye/infoverify/dal/kv"
	"github.com/yihaoye/infoverify/dal/semantics_search"
)

const CrawlTaskQueueKey = "infoverify:crawl_tasks"

func EnqueueCrawlTask(ctx context.Context, taskURL string) (string, error) {
	if taskURL == "" {
		return "", fmt.Errorf("url is empty")
	}
	if _, err := url.ParseRequestURI(taskURL); err != nil {
		return "", fmt.Errorf("invalid url: %w", err)
	}

	docID := semantics_search.IDFromURL(taskURL)
	if err := kv.Rdb.LPush(kv.Ctx, CrawlTaskQueueKey, taskURL).Err(); err != nil {
		return "", err
	}
	return docID, nil
}
