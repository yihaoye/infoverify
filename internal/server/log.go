package server

import (
	"log"
	"net/http"
	"time"
)

func LoggingMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		now := time.Now()
		wrappedWriter := &ResponseWriterWrapper{ResponseWriter: w, StatusCode: http.StatusOK}

		next(wrappedWriter, r)

		log.Printf("[%s] %s %s %d %s\n",
			r.Method,
			r.RemoteAddr,
			r.URL.Path,
			wrappedWriter.StatusCode,
			time.Since(now),
		)
	}
}

// 包装 ResponseWriter 以捕获状态码
type ResponseWriterWrapper struct {
	http.ResponseWriter
	StatusCode int
}

func (rw *ResponseWriterWrapper) WriteHeader(code int) {
	rw.StatusCode = code
	rw.ResponseWriter.WriteHeader(code)
}
