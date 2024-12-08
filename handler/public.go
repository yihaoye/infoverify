package handler

import (
	"fmt"
	"net/http"
)

func HandleCheckRequest(w http.ResponseWriter, r *http.Request) {
	// ctx := r.Context()
	queryParams := r.URL.Query()
	key := queryParams.Get("key") // 获取 URL 参数: ?key=value
	if key == "" {
		key = "default"
	}

	res := ""
	fmt.Fprintf(w, "%s", res)
}

func HandleAdvancedCheckRequest(w http.ResponseWriter, r *http.Request) {
	HandleCheckRequest(w, r)
}
