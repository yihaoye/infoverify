package cross_validation

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/yihaoye/infoverify/internal/service/core/skill"
	"github.com/yihaoye/infoverify/internal/service/support/web_crawler"
)

// Skill evaluates cross-validation.
type Skill struct{}

func (Skill) Name() string    { return "cross_validation" }
func (Skill) Weight() float64 { return 0.3 }

func (Skill) Evaluate(ctx context.Context, in skill.Input) (skill.Result, error) {
	// 交叉验证：仅支持 web 模式（复抓原 URL）。
	mode := strings.ToLower(strings.TrimSpace(os.Getenv("CROSS_VALIDATE_MODE")))
	if mode == "" {
		mode = "web"
	}

	result := skill.Result{
		Skill:  "cross_validation",
		Weight: 0.3,
	}

	switch mode {
	case "web":
		// 仅复抓原 URL 做一致性检查。
		if in.Article.URL == "" {
			result.Score = 0
			result.Summary = "web mode: no url"
			return result, nil
		}
		parsed, err := url.Parse(in.Article.URL)
		if err != nil {
			result.Score = 0
			result.Summary = "web mode: invalid url"
			return result, nil
		}
		crawler := web_crawler.NewWebCrawler([]string{parsed.Host})
		article, err := crawler.Crawl(in.Article.URL)
		if err != nil {
			result.Score = 0
			result.Summary = "web mode: crawl failed"
			return result, nil
		}
		consistent := 0
		// 标题一致 + 内容非空 作为最小一致性判断。
		if article.Title == in.Article.Title {
			consistent++
		}
		if len(article.Content) > 0 && len(in.Article.Content) > 0 {
			consistent++
		}
		result.Score = float64(consistent) / 2.0
		result.Summary = fmt.Sprintf("web recrawl consistency=%d/2", consistent)
		return result, nil
	default:
		result.Score = 0
		result.Summary = "invalid CROSS_VALIDATE_MODE"
		return result, nil
	}
}

func scoreByCount(count int) float64 {
	switch {
	case count >= 3:
		return 0.8
	case count == 2:
		return 0.6
	case count == 1:
		return 0.3
	default:
		return 0.1
	}
}
