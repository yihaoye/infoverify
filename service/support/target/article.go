package target

import (
	"context"
	"log"

	"github.com/google/uuid"
	"github.com/yihaoye/infoverify/dal/semantics_search"
)

func CreateArticle(ctx context.Context, title, content, author string) (string, error) {
	esClient := semantics_search.ArticleESClient

	// Index a single article
	article := semantics_search.Article{
		ID:      uuid.New().String(),
		Title:   title,
		Content: content,
		Author:  author,
	}
	err := esClient.IndexArticle(article)
	if err != nil {
		log.Printf("Failed to index article: %v", err)
		return "", err
	}

	return article.ID, nil
}

func SearchArticle(ctx context.Context, query []string, size int) string {
	articles, err := semantics_search.ArticleESClient.SearchArticles(query, size)
	if err != nil {
		return ""
	}
	return articles[0].Content
}
