package server

import (
	"net/http"

	"github.com/yihaoye/infoverify/internal/handler"
)

func SetupRoutes() {
	// 对外 HTTP 路由入口，保持薄层逻辑。
	http.HandleFunc("/api/basic/check", LoggingMiddleware(handler.HandleCheckRequest))
	http.HandleFunc("/api/basic/score", LoggingMiddleware(handler.HandleScoreRequest))
	http.HandleFunc("/api/basic/get", LoggingMiddleware(handler.HandleReviewRequest))
	http.HandleFunc("/api/basic/search", LoggingMiddleware(handler.HandleSearchRequest))
	http.HandleFunc("/api/basic/tasks/get", LoggingMiddleware(handler.HandleTaskGetRequest))
	http.HandleFunc("/api/basic/tasks/list", LoggingMiddleware(handler.HandleTaskListRequest))
	http.HandleFunc("/api/basic/tools/browser_rendering/health", LoggingMiddleware(handler.HandleBrowserRenderingHealth))
	// http.HandleFunc("/api/advanced/check/", AuthenticateMiddleware(handler.HandleAdvancedCheckRequest))
}
