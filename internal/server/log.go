package server

import (
	"log"
	"net/http"
	"strings"
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

// CORSMiddleware 处理 CORS 跨域请求，只允许 Chrome 扩展访问
func CORSMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		// 只允许来自 Chrome 扩展的请求（以 chrome-extension:// 开头）
		if !strings.HasPrefix(origin, "chrome-extension://") {
			http.Error(w, "Forbidden: only Chrome extensions allowed", http.StatusForbidden)
			return
		}

		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Max-Age", "3600")

		// 处理 OPTIONS 预检请求
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next(w, r)
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
