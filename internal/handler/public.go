package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/yihaoye/infoverify/internal/model"
	"github.com/yihaoye/infoverify/internal/service/core/cross_validation_text"
	"github.com/yihaoye/infoverify/internal/service/core/dikw"
	"github.com/yihaoye/infoverify/internal/service/core/llm_assess"
	"github.com/yihaoye/infoverify/internal/service/core/reproducible"
	"github.com/yihaoye/infoverify/internal/service/core/skill"
	"github.com/yihaoye/infoverify/internal/service/support/external"
)

type scoreRequest struct {
	Text  string `json:"text"`
	URL   string `json:"url,omitempty"`
	Title string `json:"title,omitempty"`
	LLM   bool   `json:"llm,omitempty"`
}

func HandleScoreRequest(w http.ResponseWriter, r *http.Request) {
	// 轻量打分入口：仅根据输入文本计算三大原则的分项分数与总分。
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusInternalServerError)
		return
	}

	var payload scoreRequest
	if err := json.Unmarshal(body, &payload); err != nil {
		http.Error(w, "Failed to unmarshal request body", http.StatusBadRequest)
		return
	}
	payload.Text = strings.TrimSpace(payload.Text)
	payload.URL = strings.TrimSpace(payload.URL)
	payload.Title = strings.TrimSpace(payload.Title)

	var fetched map[string]interface{}
	if payload.Text == "" {
		// URL-only mode: fetch content (allowlist enforced by external package).
		if payload.URL == "" {
			http.Error(w, "Missing text or url", http.StatusBadRequest)
			return
		}
		parsed, err := url.Parse(payload.URL)
		if err != nil || parsed.Host == "" {
			http.Error(w, "Invalid url", http.StatusBadRequest)
			return
		}
		if parsed.Scheme != "http" && parsed.Scheme != "https" {
			http.Error(w, "Invalid url scheme", http.StatusBadRequest)
			return
		}

		page, err := external.FetchURLUnrestricted(ctx, payload.URL)
		if err != nil {
			http.Error(w, fmt.Sprintf("Fetch url failed: %v", err), http.StatusBadRequest)
			return
		}
		payload.Text = strings.TrimSpace(page.Content)
		if payload.Title == "" {
			payload.Title = strings.TrimSpace(page.Title)
		}
		fetched = map[string]interface{}{
			"url":         page.URL,
			"title":       page.Title,
			"content_len": len(page.Content),
			"preview":     previewText(page.Content, 240),
		}

		if payload.Text == "" {
			http.Error(w, "Empty content fetched from url", http.StatusBadRequest)
			return
		}
	}

	in := skill.Input{
		Article: model.Article{
			URL:     payload.URL,
			Title:   payload.Title,
			Content: payload.Text,
			Author:  "",
		},
	}

	cvRes, _ := (cross_validation_text.Skill{}).Evaluate(ctx, in)
	repRes, _ := (reproducible.Skill{}).Evaluate(ctx, in)
	detailRes, _ := (dikw.Skill{}).Evaluate(ctx, in)

	results := []skill.Result{cvRes, repRes, detailRes}
	overall := weightedAverage(results)

	var llmAssess llm_assess.Assessment
	if payload.LLM {
		// Optional and independent: Gemini provides its own credibility assessment, separate from rule scores.
		if a, err := llm_assess.AssessCredibility(ctx, payload.Text); err == nil {
			llmAssess = a
		} else {
			llmAssess = a
		}
	}

	w.Header().Set("Content-Type", "application/json")
	resp := map[string]interface{}{
		"overall_score": overall,
		"rule_scores": map[string]float64{
			cvRes.Skill:     cvRes.Score,
			repRes.Skill:    repRes.Score,
			detailRes.Skill: detailRes.Score,
		},
		"results": results,
	}
	if fetched != nil {
		resp["fetched"] = fetched
	}
	if payload.LLM {
		resp["llm_assessment"] = llmAssess
	}
	_ = json.NewEncoder(w).Encode(resp)
}

func weightedAverage(results []skill.Result) float64 {
	var sumScore float64
	var sumWeight float64
	for _, r := range results {
		if r.Weight <= 0 {
			continue
		}
		sumScore += r.Score * r.Weight
		sumWeight += r.Weight
	}
	if sumWeight == 0 {
		return 0
	}
	return sumScore / sumWeight
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
