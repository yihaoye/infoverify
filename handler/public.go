package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/yihaoye/infoverify/service/support/target"
)

func HandleCheckRequest(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusInternalServerError)
		return
	}
	// body has json field "content"
	var payload map[string]string
	err = json.Unmarshal(body, &payload)
	if err != nil {
		http.Error(w, "Failed to unmarshal request body", http.StatusInternalServerError)
		return
	}

	title := payload["title"]
	author := payload["author"]
	content := payload["content"]
	if title == "" || author == "" || content == "" {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	res, err := target.CreateArticle(ctx, title, author, content)
	if err != nil {
		http.Error(w, "Failed to create article", http.StatusInternalServerError)
		return
	}

	fmt.Fprintf(w, "success: %s", res)
}

func HandleAdvancedCheckRequest(w http.ResponseWriter, r *http.Request) {
	HandleCheckRequest(w, r)
}
