package server

import (
	"net/http"

	"github.com/yihaoye/infoverify/internal/handler"
)

func SetupRoutes() {
	// 对外 HTTP 路由入口，保持薄层逻辑。
	http.HandleFunc("/api/basic/score", LoggingMiddleware(handler.HandleScoreRequest))
}
