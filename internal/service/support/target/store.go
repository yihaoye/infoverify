package target

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/yihaoye/infoverify/internal/dal/postgres"
	"github.com/yihaoye/infoverify/internal/model"
	"github.com/yihaoye/infoverify/internal/service/core/skill"
)

func SaveArticle(article model.Article) (string, error) {
	// 保存文章并更新全文检索字段。
	if article.ID == "" {
		if article.URL != "" {
			article.ID = IDFromURL(article.URL)
		} else {
			article.ID = uuid.New().String()
		}
	}
	db := postgres.DB()
	if db == nil {
		return "", errors.New("postgres not initialized")
	}

	query := `
INSERT INTO articles (id, url, title, author, content)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (id) DO UPDATE SET
  url = EXCLUDED.url,
  title = EXCLUDED.title,
  author = EXCLUDED.author,
  content = EXCLUDED.content
`
	_, err := db.ExecContext(context.Background(), query, article.ID, article.URL, article.Title, article.Author, article.Content)
	if err != nil {
		return "", fmt.Errorf("save article: %w", err)
	}
	_, err = db.ExecContext(context.Background(),
		`UPDATE articles SET content_tsv = to_tsvector('simple', content) WHERE id = $1`, article.ID)
	if err != nil {
		return "", fmt.Errorf("update article tsv: %w", err)
	}
	return article.ID, nil
}

func LoadArticle(id string) (*model.Article, error) {
	// 根据文章 ID 读取内容。
	if id == "" {
		return nil, errors.New("id is empty")
	}
	db := postgres.DB()
	if db == nil {
		return nil, errors.New("postgres not initialized")
	}

	var article model.Article
	query := `SELECT id, url, title, author, content FROM articles WHERE id = $1`
	if err := db.QueryRowContext(context.Background(), query, id).
		Scan(&article.ID, &article.URL, &article.Title, &article.Author, &article.Content); err != nil {
		return nil, fmt.Errorf("load article: %w", err)
	}
	return &article, nil
}

func SaveReport(id string, report skill.Report) error {
	// 保存分析报告（JSON）。
	if id == "" {
		return errors.New("id is empty")
	}
	db := postgres.DB()
	if db == nil {
		return errors.New("postgres not initialized")
	}

	data, err := json.Marshal(report)
	if err != nil {
		return fmt.Errorf("marshal report: %w", err)
	}

	query := `
INSERT INTO reports (article_id, report)
VALUES ($1, $2)
ON CONFLICT (article_id) DO UPDATE SET
  report = EXCLUDED.report
`
	_, err = db.ExecContext(context.Background(), query, id, data)
	if err != nil {
		return fmt.Errorf("save report: %w", err)
	}
	return nil
}

func LoadReport(id string) (skill.Report, bool) {
	// 读取分析报告。
	db := postgres.DB()
	if db == nil {
		return skill.Report{}, false
	}

	var data []byte
	query := `SELECT report FROM reports WHERE article_id = $1`
	if err := db.QueryRowContext(context.Background(), query, id).Scan(&data); err != nil {
		return skill.Report{}, false
	}
	var report skill.Report
	if err := json.Unmarshal(data, &report); err != nil {
		return skill.Report{}, false
	}
	return report, true
}
