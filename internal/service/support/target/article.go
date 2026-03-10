package target

import (
	"context"

	"github.com/google/uuid"
	"github.com/yihaoye/infoverify/internal/model"
)

func CreateArticle(ctx context.Context, title, author, content string) (string, error) {
	article := model.Article{
		ID:      uuid.New().String(),
		Title:   title,
		Content: content,
		Author:  author,
	}
	return SaveArticle(article)
}

func GetArticle(ctx context.Context, id string) (*model.Article, error) {
	return LoadArticle(id)
}
