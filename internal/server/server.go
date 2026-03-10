package server

import (
	"net/http"

	"github.com/yihaoye/infoverify/internal/handler"
)

func SetupRoutes() {

	http.HandleFunc("/api/basic/check", LoggingMiddleware(handler.HandleCheckRequest))
	http.HandleFunc("/api/basic/get", LoggingMiddleware(handler.HandleReviewRequest))
	http.HandleFunc("/api/basic/search", LoggingMiddleware(handler.HandleSearchRequest))
	http.HandleFunc("/api/basic/tasks/get", LoggingMiddleware(handler.HandleTaskGetRequest))
	http.HandleFunc("/api/basic/tasks/list", LoggingMiddleware(handler.HandleTaskListRequest))
	// http.HandleFunc("/api/advanced/check/", AuthenticateMiddleware(handler.HandleAdvancedCheckRequest))
}
