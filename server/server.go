package server

import (
	"net/http"

	"github.com/yihaoye/infoverify/handler"
)

func SetupRoutes() {

	http.HandleFunc("/api/basic/check", LoggingMiddleware(handler.HandleCheckRequest))

	// http.HandleFunc("/api/advanced/check/", AuthenticateMiddleware(handler.HandleAdvancedCheckRequest))
}
