package server

import (
	"net/http"

	"github.com/yihaoye/infoverify/internal/handler"
)

func SetupRoutes() {

	http.HandleFunc("/api/basic/check", LoggingMiddleware(handler.HandleCheckRequest))
	http.HandleFunc("/api/basic/get", LoggingMiddleware(handler.HandleReviewRequest))
	// http.HandleFunc("/api/advanced/check/", AuthenticateMiddleware(handler.HandleAdvancedCheckRequest))
}
