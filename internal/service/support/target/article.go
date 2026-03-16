package target

import (
	"context"

	"github.com/google/uuid"
	"github.com/yihaoye/infoverify/internal/model"
)

func CreateArticle(ctx context.Context, title, author, content string) (string, error) {
	// 生成文章 ID 并入库。
	article := model.Article{
		ID:      uuid.New().String(),
		Title:   title,
		Content: content,
		Author:  author,
	}
	return SaveArticle(article)
}

func GetArticle(ctx context.Context, id string) (*model.Article, error) {
	// 根据 ID 读取文章内容。
	return LoadArticle(id)
}
