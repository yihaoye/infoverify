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

func HandleReviewRequest(w http.ResponseWriter, r *http.Request) {
	// get article content by url id
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	ctx := r.Context()
	article, err := target.GetArticle(ctx, id)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get article: %v", err), http.StatusInternalServerError)
		return
	}

	// Convert article to JSON for better visibility
	response, err := json.Marshal(article)
	if err != nil {
		http.Error(w, "Failed to marshal article", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(response)
}
