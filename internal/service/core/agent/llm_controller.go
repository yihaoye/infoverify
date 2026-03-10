package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"github.com/yihaoye/infoverify/internal/clients"
	"github.com/yihaoye/infoverify/internal/model"
	"github.com/yihaoye/infoverify/internal/service/core/dikw"
	"github.com/yihaoye/infoverify/internal/service/core/reproducible"
	"github.com/yihaoye/infoverify/internal/service/core/skill"
	"github.com/yihaoye/infoverify/internal/service/support/external"
	"github.com/yihaoye/infoverify/internal/service/support/search"
)

const maxLLMSteps = 4

type llmToolCall struct {
	Name      string
	CallID    string
	Arguments map[string]interface{}
}

func RunLLMController(ctx context.Context, article model.Article) (skill.Report, error) {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		return skill.Report{}, errors.New("OPENAI_API_KEY is not set")
	}
	client, err := clients.NewOpenAIClient()
	if err != nil {
		return skill.Report{}, err
	}

	modelName := os.Getenv("OPENAI_MODEL")
	if modelName == "" {
		modelName = "gpt-4o-mini"
	}

	strictFalse := false
	tools := []clients.ToolDef{
		{
			Type:        "function",
			Name:        "search_articles",
			Description: "Search local articles by query",
			Strict:      &strictFalse,
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"query": map[string]interface{}{
						"type":        "string",
						"description": "search query",
					},
					"limit": map[string]interface{}{
						"type":        "integer",
						"description": "max results",
					},
				},
				"required": []string{"query"},
				"additionalProperties": false,
			},
		},
		{
			Type:        "function",
			Name:        "external_search",
			Description: "Search external sources (requires SEARCH_API_URL/SEARCH_API_KEY)",
			Strict:      &strictFalse,
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"query": map[string]interface{}{
						"type":        "string",
						"description": "search query",
					},
					"limit": map[string]interface{}{
						"type":        "integer",
						"description": "max results",
					},
				},
				"required": []string{"query"},
				"additionalProperties": false,
			},
		},
		{
			Type:        "function",
			Name:        "fetch_url",
			Description: "Fetch and extract content from a URL (allowlist enforced)",
			Strict:      &strictFalse,
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"url": map[string]interface{}{
						"type":        "string",
						"description": "target url",
					},
				},
				"required": []string{"url"},
				"additionalProperties": false,
			},
		},
	}

	systemPrompt := "You are the controller of an information verification agent. " +
		"Use tools to gather evidence and run skills. Then provide a concise final judgment. " +
		"Do not fabricate facts; rely on tool outputs."

	collected := runCoreSkills(ctx, article)
	collectedJSON, _ := json.Marshal(collected)

	input := []interface{}{
		map[string]interface{}{
			"role": "user",
			"content": []interface{}{
				map[string]interface{}{
					"type": "input_text",
					"text": systemPrompt + "\n\nArticle:\n" + article.Content +
						"\n\nCoreSkills (already executed):\n" + string(collectedJSON),
				},
			},
		},
	}

	var finalText string

	for step := 0; step < maxLLMSteps; step++ {
		resp, err := client.CreateResponseWithTools(ctx, modelName, input, tools, "auto")
		if err != nil {
			return skill.Report{}, err
		}

		calls := extractToolCalls(resp)
		if len(calls) == 0 {
			text, _ := clients.ExtractOutputText(&resp)
			finalText = text
			break
		}

		for _, call := range calls {
			out, res := executeTool(ctx, call, article)
			if res != nil {
				collected = append(collected, *res)
			}
			input = append(input, map[string]interface{}{
				"type":    "function_call_output",
				"call_id": call.CallID,
				"output":  out,
			})
		}
	}

	report := buildReport(article, collected, finalText)
	return report, nil
}

func executeTool(ctx context.Context, call llmToolCall, article model.Article) (string, *skill.Result) {
	switch call.Name {
	case "search_articles":
		query, _ := call.Arguments["query"].(string)
		limit := 10
		if v, ok := call.Arguments["limit"].(float64); ok {
			limit = int(v)
		}
		arts, err := search.SearchArticles(ctx, query, limit)
		if err != nil {
			return toolError(err), nil
		}
		out := map[string]interface{}{
			"count": len(arts),
			"items": arts,
		}
		b, _ := json.Marshal(out)
		return string(b), nil
	case "external_search":
		query, _ := call.Arguments["query"].(string)
		limit := 5
		if v, ok := call.Arguments["limit"].(float64); ok {
			limit = int(v)
		}
		items, err := external.Search(ctx, query, limit)
		if err != nil {
			return toolError(err), nil
		}
		out := map[string]interface{}{
			"count": len(items),
			"items": items,
		}
		b, _ := json.Marshal(out)
		return string(b), nil
	case "fetch_url":
		raw, _ := call.Arguments["url"].(string)
		page, err := external.FetchURL(raw)
		if err != nil {
			return toolError(err), nil
		}
		b, _ := json.Marshal(page)
		return string(b), nil
	default:
		return toolError(fmt.Errorf("unknown tool: %s", call.Name)), nil
	}
}

func runCoreSkills(ctx context.Context, article model.Article) []skill.Result {
	results := make([]skill.Result, 0, 3)

	d := dikw.Skill{}
	r := reproducible.Skill{}
	cv := skill.Result{Skill: "cross_validation", Score: 0, Weight: 0.3, Summary: "not implemented"}

	if res, err := d.Evaluate(ctx, skill.Input{Article: article}); err == nil {
		if res.Skill == "" {
			res.Skill = "detail_richness"
		}
		if res.Weight == 0 {
			res.Weight = d.Weight()
		}
		results = append(results, res)
	}
	if res, err := r.Evaluate(ctx, skill.Input{Article: article}); err == nil {
		if res.Skill == "" {
			res.Skill = "reproducibility"
		}
		if res.Weight == 0 {
			res.Weight = r.Weight()
		}
		results = append(results, res)
	}
	results = append(results, cv)

	return results
}

func extractToolCalls(resp clients.ResponsesResponse) []llmToolCall {
	var calls []llmToolCall
	for _, out := range resp.Output {
		if out.Type == "function_call" {
			args := map[string]interface{}{}
			if out.Arguments != "" {
				_ = json.Unmarshal([]byte(out.Arguments), &args)
			}
			calls = append(calls, llmToolCall{
				Name:      out.Name,
				CallID:    out.CallID,
				Arguments: args,
			})
		}
	}
	return calls
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
