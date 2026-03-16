package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/yihaoye/infoverify/internal/service/core/skill"
	"github.com/yihaoye/infoverify/internal/service/support/browser_rendering"
	"github.com/yihaoye/infoverify/internal/service/support/external"
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
	// 核心入口：支持 URL 入队或直接提交文章内容。
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
		// URL 模式：入队等待抓取和分析。
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

	// 直接内容模式：立即入库并触发分析。
	res, err := target.CreateArticle(ctx, payload.Article.Title, payload.Article.Author, payload.Article.Content)
	if err != nil {
		http.Error(w, "Failed to create article", http.StatusInternalServerError)
		return
	}
	_, _ = target.UpsertTask(res, "", "indexed", "")

	article, _ := target.GetArticle(ctx, res)
	var report interface{}
	var evidence interface{}
	if article != nil {
		_ = target.UpdateTaskStatus(res, "analyzing", "")
		if r, err := target.AnalyzeArticle(ctx, *article); err == nil {
			_ = target.SaveReport(res, r)
			report = r
			evidence = skill.ExtractEvidence(r.Results)
			_ = target.UpdateTaskStatus(res, "analyzed", "")
		} else {
			_ = target.UpdateTaskStatus(res, "failed", err.Error())
			http.Error(w, fmt.Sprintf("Analyze failed: %v", err), http.StatusInternalServerError)
			return
		}
	}

	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   "indexed",
		"id":       res,
		"report":   report,
		"evidence": evidence,
	})
}

func HandleAdvancedCheckRequest(w http.ResponseWriter, r *http.Request) {
	HandleCheckRequest(w, r)
}

func HandleReviewRequest(w http.ResponseWriter, r *http.Request) {
	// 根据任务/文章 ID 返回文章与报告。
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
		responseBody["evidence"] = skill.ExtractEvidence(report.Results)
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
	// 仅本地检索（Postgres）。
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
	// 查询单个任务状态。
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
	// 任务列表（用于前端轮询）。
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

func HandleBrowserRenderingHealth(w http.ResponseWriter, r *http.Request) {
	// Cloudflare Browser Rendering 健康检查与诊断。
	ctx := r.Context()
	raw := r.URL.Query().Get("url")
	configured := browser_rendering.Configured()

	response := map[string]interface{}{
		"configured": configured,
	}

	if raw == "" {
		// 不提供 URL 时，仅返回配置状态。
		if !configured {
			response["status"] = "not_configured"
		} else {
			response["status"] = "ready"
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(response)
		return
	}

	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		http.Error(w, "Invalid url", http.StatusBadRequest)
		return
	}
	if !external.IsAllowedHost(parsed.Host) {
		// 仅允许白名单域名，避免滥用。
		http.Error(w, "Host not allowed", http.StatusBadRequest)
		return
	}

	start := time.Now()
	md, err := browser_rendering.FetchMarkdown(ctx, raw)
	elapsed := time.Since(start)
	if err != nil {
		response["status"] = "error"
		response["error"] = err.Error()
		response["elapsed_ms"] = elapsed.Milliseconds()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(response)
		return
	}

	response["status"] = "ok"
	response["title"] = markdownTitle(md)
	response["content_len"] = len(md)
	response["preview"] = previewText(md, 300)
	response["elapsed_ms"] = elapsed.Milliseconds()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(response)
}

func markdownTitle(md string) string {
	// 从 Markdown 中抽取一级标题。
	lines := strings.Split(md, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "# ") {
			return strings.TrimSpace(strings.TrimPrefix(line, "# "))
		}
	}
	return ""
}

func previewText(md string, max int) string {
	// 截取预览文本，避免返回过长内容。
	if max <= 0 || md == "" {
		return ""
	}
	if len(md) <= max {
		return md
	}
	return md[:max] + "..."
}
