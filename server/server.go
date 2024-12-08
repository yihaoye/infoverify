package server

import (
	"net/http"

	"github.com/yihaoye/infoverify/handler"
)

func SetupRoutes() {

	http.HandleFunc("/api/utils/check", LoggingMiddleware(handler.HandleCheckRequest))

	http.HandleFunc("/api/sensitive/data/", AuthenticateMiddleware(handler.HandleSensitiveDataRequest))
}
