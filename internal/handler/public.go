package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/yihaoye/infoverify/internal/service/support/search"
	"github.com/yihaoye/infoverify/internal/service/support/target"
)

type checkRequest struct {
	URL     string `json:"url,omitempty"`
	Article *struct {
		Title   string `json:"title"`
		Author  string `json:"author"`
		Content string `json:"content"`
	} `json:"article,omitempty"`
}

func HandleCheckRequest(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusInternalServerError)
		return
	}
	var payload checkRequest
	err = json.Unmarshal(body, &payload)
	if err != nil {
		http.Error(w, "Failed to unmarshal request body", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	if payload.URL != "" {
		id, err := target.EnqueueCrawlTask(ctx, payload.URL)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to enqueue task: %v", err), http.StatusBadRequest)
			return
		}
		_, _ = target.UpsertTask(id, payload.URL, "queued", "")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"status": "queued",
			"id":     id,
		})
		return
	}

	if payload.Article == nil || payload.Article.Title == "" || payload.Article.Author == "" || payload.Article.Content == "" {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	res, err := target.CreateArticle(ctx, payload.Article.Title, payload.Article.Author, payload.Article.Content)
	if err != nil {
		http.Error(w, "Failed to create article", http.StatusInternalServerError)
		return
	}
	_, _ = target.UpsertTask(res, "", "indexed", "")

	article, _ := target.GetArticle(ctx, res)
	var report interface{}
	if article != nil {
		_ = target.UpdateTaskStatus(res, "analyzing", "")
		if r, err := target.AnalyzeArticle(ctx, *article); err == nil {
			_ = target.SaveReport(res, r)
			report = r
			_ = target.UpdateTaskStatus(res, "analyzed", "")
		} else {
			_ = target.UpdateTaskStatus(res, "failed", err.Error())
			http.Error(w, fmt.Sprintf("Analyze failed: %v", err), http.StatusInternalServerError)
			return
		}
	}

	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "indexed",
		"id":     res,
		"report": report,
	})
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

	responseBody := map[string]interface{}{
		"article": article,
	}
	if report, ok := target.LoadReport(id); ok {
		responseBody["report"] = report
	}

	response, err := json.Marshal(responseBody)
	if err != nil {
		http.Error(w, "Failed to marshal article", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(response)
}

func HandleSearchRequest(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		http.Error(w, "Missing q", http.StatusBadRequest)
		return
	}
	ctx := r.Context()
	results, err := search.SearchArticles(ctx, q, 10)
	if err != nil {
		http.Error(w, fmt.Sprintf("Search failed: %v", err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"query":   q,
		"results": results,
	})
}

func HandleTaskGetRequest(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "Missing id", http.StatusBadRequest)
		return
	}
	ctx := r.Context()
	task, err := target.GetTask(ctx, id)
	if err != nil {
		http.Error(w, fmt.Sprintf("Get task failed: %v", err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(task)
}

func HandleTaskListRequest(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tasks, err := target.ListTasks(ctx, 20)
	if err != nil {
		http.Error(w, fmt.Sprintf("List tasks failed: %v", err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"tasks": tasks,
	})
}
