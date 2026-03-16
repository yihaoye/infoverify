package search

import (
	"context"
	"fmt"

	"github.com/yihaoye/infoverify/internal/dal/postgres"
	"github.com/yihaoye/infoverify/internal/model"
)

func SearchArticles(ctx context.Context, query string, limit int) ([]model.Article, error) {
	// Postgres 全文检索（tsvector + websearch_to_tsquery）。
	db := postgres.DB()
	if db == nil {
		return nil, fmt.Errorf("postgres not initialized")
	}
	if limit <= 0 {
		limit = 10
	}

	rows, err := db.QueryContext(ctx, `
SELECT id, url, title, author, content
FROM articles
WHERE content_tsv @@ websearch_to_tsquery('simple', $1)
ORDER BY ts_rank(content_tsv, websearch_to_tsquery('simple', $1)) DESC
LIMIT $2
`, query, limit)
	if err != nil {
		return nil, fmt.Errorf("search articles: %w", err)
	}
	defer rows.Close()

	var res []model.Article
	for rows.Next() {
		var a model.Article
		if err := rows.Scan(&a.ID, &a.URL, &a.Title, &a.Author, &a.Content); err != nil {
			return nil, fmt.Errorf("scan article: %w", err)
		}
		res = append(res, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows: %w", err)
	}
	return res, nil
}
