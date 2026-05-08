package server

import (
	"net/http"

	"github.com/yihaoye/infoverify/internal/handler"
)

// wrapWithMiddleware 统一为所有路由应用中间件：CORS -> 日志
func wrapWithMiddleware(h http.HandlerFunc) http.HandlerFunc {
	return CORSMiddleware(LoggingMiddleware(h))
}

func SetupRoutes() {
	// 对外 HTTP 路由入口，保持薄层逻辑。
	// 所有路由都应用完整的中间件链
	http.HandleFunc("/api/basic/score", wrapWithMiddleware(handler.HandleScoreRequest))
}
