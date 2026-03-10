package target

import (
	"context"
	"log"

	"github.com/google/uuid"
	"github.com/yihaoye/infoverify/dal/semantics_search"
	"github.com/yihaoye/infoverify/model"
)

func CreateArticle(ctx context.Context, title, author, content string) (string, error) {
	esClient := semantics_search.ArticleESClient

	// Index a single article
	article := model.Article{
		ID:      uuid.New().String(),
		Title:   title,
		Content: content,
		Author:  author,
	}
	docID, err := esClient.IndexArticle(article)
	if err != nil {
		log.Printf("Failed to index article: %v", err)
		return "", err
	}

	return docID, nil
}

func GetArticle(ctx context.Context, id string) (*model.Article, error) {
	article, err := semantics_search.ArticleESClient.GetArticle(id)
	if err != nil {
		return nil, err
	}
	return article, nil
}

func SearchArticle(ctx context.Context, query []string, size int) string {
	articles, err := semantics_search.ArticleESClient.SearchArticles(query, size)
	if err != nil {
		return ""
	}
	return articles[0].Content
}
