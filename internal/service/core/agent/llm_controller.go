package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/yihaoye/infoverify/internal/clients"
	"github.com/yihaoye/infoverify/internal/model"
	"github.com/yihaoye/infoverify/internal/service/core/cross_validation"
	"github.com/yihaoye/infoverify/internal/service/core/dikw"
	"github.com/yihaoye/infoverify/internal/service/core/reproducible"
	"github.com/yihaoye/infoverify/internal/service/core/skill"
	"github.com/yihaoye/infoverify/internal/service/support/canonical"
	"github.com/yihaoye/infoverify/internal/service/support/external"
	"github.com/yihaoye/infoverify/internal/service/support/news"
)

const maxLLMSteps = 4

type llmToolCall struct {
	Name      string
	Arguments map[string]interface{}
}

func RunLLMController(ctx context.Context, article model.Article) (skill.Report, error) {
	// LLM 作为总控调度器：调用工具并输出最终判断。
	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		return skill.Report{}, errors.New("GEMINI_API_KEY is not set")
	}
	client, err := clients.NewGeminiClient()
	if err != nil {
		return skill.Report{}, err
	}

	modelName := os.Getenv("GEMINI_MODEL")
	if modelName == "" {
		modelName = "gemini-2.5-flash"
	}

	decls := []clients.GeminiFuncDecl{
		// MVP 工具集合。
		{Name: "news_search", Description: "Search recent US-market news links through Google News RSS (with optional SEC filings when ticker is provided)", Parameters: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"query": map[string]interface{}{"type": "string"}, "timespan": map[string]interface{}{"type": "string", "description": "Optional recency window such as 24h, 1d, or 7d"}, "max_records": map[string]interface{}{"type": "integer"}, "ticker": map[string]interface{}{"type": "string", "description": "Optional US stock ticker (e.g., AAPL) to include SEC filings"}}, "required": []string{"query"}}},
		{Name: "canonical_refs", Description: "Lookup canonical references by domain or keyword (physics, mathematics, chemistry, medicine, biology)", Parameters: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"domain": map[string]interface{}{"type": "string"}, "keyword": map[string]interface{}{"type": "string"}, "limit": map[string]interface{}{"type": "integer"}}}},
		{Name: "fetch_url", Description: "Fetch and extract content from a URL (allowlist enforced)", Parameters: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"url": map[string]interface{}{"type": "string"}}, "required": []string{"url"}}},
	}
	tools := []clients.GeminiTool{{FunctionDeclarations: decls}}

	systemPrompt := "You are the controller of an information verification agent. " +
		"Use tools to gather evidence when helpful, especially from authoritative sources. " +
		"Always provide a concise final judgment. " +
		"If evidence is insufficient, say you are uncertain and explain why. " +
		"Do not fabricate facts; rely on tool outputs and the article."

	collected := runCoreSkills(ctx, article)
	collectedJSON, _ := json.Marshal(collected)

	contents := []clients.GeminiContent{
		{
			Role: "user",
			Parts: []clients.GeminiPart{
				// 把核心技能的结果作为上下文喂给模型。
				{Text: systemPrompt + "\n\nArticle:\n" + article.Content + "\n\nCoreSkills (already executed):\n" + string(collectedJSON)},
			},
		},
	}

	var finalText string

	for step := 0; step < maxLLMSteps; step++ {
		// 以工具调用为主的多轮推理。
		req := clients.GeminiRequest{
			Contents:         contents,
			Tools:            tools,
			GenerationConfig: map[string]interface{}{"temperature": 0.2},
		}
		resp, err := client.GenerateContent(ctx, modelName, req)
		if err != nil {
			return skill.Report{}, err
		}

		calls := clients.ExtractFunctionCalls(resp)
		if len(calls) == 0 {
			finalText = clients.ExtractText(resp)
			break
		}

		// append model function call to contents
		modelParts := make([]clients.GeminiPart, 0, len(calls))
		for _, call := range calls {
			modelParts = append(modelParts, clients.GeminiPart{FunctionCall: &clients.GeminiFuncCall{Name: call.Name, Args: call.Args}})
		}
		contents = append(contents, clients.GeminiContent{Role: "model", Parts: modelParts})

		for _, call := range calls {
			// 执行工具并回填结果。
			out, res := executeTool(ctx, llmToolCall{Name: call.Name, Arguments: call.Args}, article)
			if res != nil {
				collected = append(collected, *res)
			}
			contents = append(contents, clients.GeminiContent{
				Role: "user",
				Parts: []clients.GeminiPart{
					{FunctionResponse: &clients.GeminiFuncResp{Name: call.Name, Response: map[string]interface{}{"output": out}}},
				},
			})
		}
	}

	if finalText == "" {
		// Fallback: ask for final judgment without tools.
		// 如果模型一直在调用工具但没有收敛，强制让它给出总结判断。
		contents = append(contents, clients.GeminiContent{
			Role: "user",
			Parts: []clients.GeminiPart{
				{Text: "Provide final judgment now. If uncertain, explain why."},
			},
		})
		req := clients.GeminiRequest{Contents: contents, Tools: tools, GenerationConfig: map[string]interface{}{"temperature": 0.2}}
		if resp, err := client.GenerateContent(ctx, modelName, req); err == nil {
			finalText = clients.ExtractText(resp)
		}
	}

	report := buildReport(article, collected, finalText)
	return report, nil
}

func executeTool(ctx context.Context, call llmToolCall, article model.Article) (string, *skill.Result) {
	// 工具分发：返回序列化结果和证据结构。
	switch call.Name {
	case "news_search":
		query, _ := call.Arguments["query"].(string)
		timespan, _ := call.Arguments["timespan"].(string)
		ticker, _ := call.Arguments["ticker"].(string)
		maxRecords := 10
		if v, ok := call.Arguments["max_records"].(float64); ok {
			maxRecords = int(v)
		}
		res, err := news.Search(ctx, news.SearchRequest{
			Query:      query,
			Timespan:   timespan,
			MaxRecords: maxRecords,
			Ticker:     ticker,
		})
		if err != nil {
			return toolError(err), nil
		}
		b, _ := json.Marshal(res)
		return string(b), buildEvidenceResult("news_search", query, newsToEvidence(res.Items))
	case "canonical_refs":
		limit := 10
		if v, ok := call.Arguments["limit"].(float64); ok {
			limit = int(v)
		}
		domain, _ := call.Arguments["domain"].(string)
		keyword, _ := call.Arguments["keyword"].(string)
		var items []canonical.Ref
		var err error
		if domain != "" {
			items, err = canonical.FilterByDomain(domain)
		} else if keyword != "" {
			items, err = canonical.SearchByKeyword(keyword, limit)
		} else {
			items, err = canonical.LoadAll()
		}
		if err != nil {
			return toolError(err), nil
		}
		if limit > 0 && len(items) > limit {
			items = items[:limit]
		}
		b, _ := json.Marshal(map[string]interface{}{
			"count": len(items),
			"items": items,
		})
		return string(b), buildEvidenceResult("canonical_refs", domain, canonicalToEvidence(items))
	case "fetch_url":
		raw, _ := call.Arguments["url"].(string)
		page, err := external.FetchURL(ctx, raw)
		if err != nil {
			return toolError(err), nil
		}
		b, _ := json.Marshal(page)
		return string(b), buildEvidenceResult("fetch_url", raw, []skill.Evidence{
			{Type: "source", Source: page.Title, URL: page.URL, Excerpt: excerpt(page.Content, 200)},
		})
	default:
		return toolError(fmt.Errorf("unknown tool: %s", call.Name)), nil
	}
}

func buildEvidenceResult(source, summary string, evidence []skill.Evidence) *skill.Result {
	// 将工具输出统一包装成 evidence 结构，便于汇总展示。
	if len(evidence) == 0 {
		return nil
	}
	return &skill.Result{
		Skill:    "evidence",
		Score:    0,
		Weight:   0,
		Summary:  source + ": " + summary,
		Evidence: evidence,
	}
}

func newsToEvidence(items []news.Item) []skill.Evidence {
	res := make([]skill.Evidence, 0, len(items))
	for i, it := range items {
		if i >= 6 {
			break
		}
		title := it.Title
		if title == "" {
			title = it.Source
		}
		ex := it.Snippet
		if ex == "" && !it.PublishedAt.IsZero() {
			ex = it.PublishedAt.UTC().Format(time.RFC3339)
		}
		res = append(res, skill.Evidence{
			Type:    "news",
			Source:  title,
			URL:     it.URL,
			Excerpt: ex,
		})
	}
	return res
}

func canonicalToEvidence(items []canonical.Ref) []skill.Evidence {
	// 只取前 3 条经典引用作为证据摘要。
	res := make([]skill.Evidence, 0, len(items))
	for i, it := range items {
		if i >= 3 {
			break
		}
		res = append(res, skill.Evidence{
			Type:    "canonical",
			Source:  it.Title,
			URL:     it.URL,
			Excerpt: it.Note,
		})
	}
	return res
}

func excerpt(s string, max int) string {
	if max <= 0 || s == "" {
		return ""
	}
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}

func runCoreSkills(ctx context.Context, article model.Article) []skill.Result {
	// 先执行固定的三大原则技能（可复现、细节丰富、交叉验证占位）。
	results := make([]skill.Result, 0, 3)

	d := dikw.Skill{}
	r := reproducible.Skill{}
	cvSkill := cross_validation.Skill{}

	if res, err := d.Evaluate(ctx, skill.Input{Article: article}); err == nil {
		// 细节丰富度。
		if res.Skill == "" {
			res.Skill = "detail_richness"
		}
		if res.Weight == 0 {
			res.Weight = d.Weight()
		}
		results = append(results, res)
	}
	if res, err := r.Evaluate(ctx, skill.Input{Article: article}); err == nil {
		// 可复现性。
		if res.Skill == "" {
			res.Skill = "reproducibility"
		}
		if res.Weight == 0 {
			res.Weight = r.Weight()
		}
		results = append(results, res)
	}
	if res, err := cvSkill.Evaluate(ctx, skill.Input{Article: article}); err == nil {
		if res.Skill == "" {
			res.Skill = cvSkill.Name()
		}
		if res.Weight == 0 {
			res.Weight = cvSkill.Weight()
		}
		results = append(results, res)
	}

	return results
}

func toolOutput(res skill.Result, err error) string {
	if err != nil {
		return toolError(err)
	}
	b, _ := json.Marshal(res)
	return string(b)
}

func toolError(err error) string {
	b, _ := json.Marshal(map[string]string{"error": err.Error()})
	return string(b)
}

func buildReport(article model.Article, results []skill.Result, finalText string) skill.Report {
	// 计算整体分数并追加 LLM 总控摘要。
	var sumWeight float64
	var sumScore float64
	for _, r := range results {
		if r.Weight == 0 {
			r.Weight = 1
		}
		sumWeight += r.Weight
		sumScore += r.Score * r.Weight
	}
	overall := 0.0
	if sumWeight > 0 {
		overall = sumScore / sumWeight
	}
	if finalText != "" {
		results = append(results, skill.Result{
			Skill:   "llm_controller",
			Score:   overall,
			Weight:  0,
			Summary: finalText,
		})
	}
	return skill.Report{
		Article:      article,
		OverallScore: overall,
		Results:      results,
	}
}
