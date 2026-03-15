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
	"github.com/yihaoye/infoverify/internal/service/support/canonical"
	"github.com/yihaoye/infoverify/internal/service/support/external"
	"github.com/yihaoye/infoverify/internal/service/support/finance"
	"github.com/yihaoye/infoverify/internal/service/support/search"
)

const maxLLMSteps = 4

type llmToolCall struct {
	Name      string
	Arguments map[string]interface{}
}

func RunLLMController(ctx context.Context, article model.Article) (skill.Report, error) {
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
		{Name: "search_articles", Description: "Search local articles by query", Parameters: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"query": map[string]interface{}{"type": "string"}, "limit": map[string]interface{}{"type": "integer"}}, "required": []string{"query"}}},
		{Name: "external_search", Description: "Search external sources (requires SEARCH_API_URL/SEARCH_API_KEY)", Parameters: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"query": map[string]interface{}{"type": "string"}, "limit": map[string]interface{}{"type": "integer"}}, "required": []string{"query"}}},
		{Name: "search_un", Description: "Search United Nations sources", Parameters: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"query": map[string]interface{}{"type": "string"}, "limit": map[string]interface{}{"type": "integer"}}, "required": []string{"query"}}},
		{Name: "search_worldbank", Description: "Search World Bank sources", Parameters: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"query": map[string]interface{}{"type": "string"}, "limit": map[string]interface{}{"type": "integer"}}, "required": []string{"query"}}},
		{Name: "search_who", Description: "Search WHO sources", Parameters: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"query": map[string]interface{}{"type": "string"}, "limit": map[string]interface{}{"type": "integer"}}, "required": []string{"query"}}},
		{Name: "search_imf", Description: "Search IMF sources", Parameters: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"query": map[string]interface{}{"type": "string"}, "limit": map[string]interface{}{"type": "integer"}}, "required": []string{"query"}}},
		{Name: "search_fao", Description: "Search FAO sources", Parameters: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"query": map[string]interface{}{"type": "string"}, "limit": map[string]interface{}{"type": "integer"}}, "required": []string{"query"}}},
		{Name: "search_oecd", Description: "Search OECD sources", Parameters: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"query": map[string]interface{}{"type": "string"}, "limit": map[string]interface{}{"type": "integer"}}, "required": []string{"query"}}},
		{Name: "search_wikipedia", Description: "Search Wikipedia sources", Parameters: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"query": map[string]interface{}{"type": "string"}, "limit": map[string]interface{}{"type": "integer"}}, "required": []string{"query"}}},
		{Name: "search_openalex", Description: "Search OpenAlex works", Parameters: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"query": map[string]interface{}{"type": "string"}, "limit": map[string]interface{}{"type": "integer"}}, "required": []string{"query"}}},
		{Name: "search_crossref", Description: "Search Crossref works", Parameters: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"query": map[string]interface{}{"type": "string"}, "limit": map[string]interface{}{"type": "integer"}}, "required": []string{"query"}}},
		{Name: "search_semanticscholar", Description: "Search Semantic Scholar works", Parameters: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"query": map[string]interface{}{"type": "string"}, "limit": map[string]interface{}{"type": "integer"}}, "required": []string{"query"}}},
		{Name: "canonical_refs", Description: "Lookup canonical references by domain or keyword (physics, mathematics, chemistry, medicine, biology)", Parameters: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"domain": map[string]interface{}{"type": "string"}, "keyword": map[string]interface{}{"type": "string"}, "limit": map[string]interface{}{"type": "integer"}}}},
		{Name: "finance_template", Description: "Get finance verification template by name (macro_check, financial_report_check, news_crosscheck)", Parameters: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"name": map[string]interface{}{"type": "string"}}, "required": []string{"name"}}},
		{Name: "source_weight", Description: "Get source credibility weight by URL or domain", Parameters: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"source": map[string]interface{}{"type": "string"}}, "required": []string{"source"}}},
		{Name: "fetch_url", Description: "Fetch and extract content from a URL (allowlist enforced)", Parameters: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"url": map[string]interface{}{"type": "string"}}, "required": []string{"url"}}},
	}
	tools := []clients.GeminiTool{{FunctionDeclarations: decls}}

	systemPrompt := "You are the controller of an information verification agent. " +
		"Use tools to gather evidence when helpful, especially from authoritative sources. " +
		"Prefer UN/WorldBank/WHO/IMF/FAO/OECD and academic sources (OpenAlex/Crossref/Semantic Scholar) when relevant. " +
		"Always provide a concise final judgment. " +
		"If evidence is insufficient, say you are uncertain and explain why. " +
		"Do not fabricate facts; rely on tool outputs and the article."

	collected := runCoreSkills(ctx, article)
	collectedJSON, _ := json.Marshal(collected)

	contents := []clients.GeminiContent{
		{
			Role: "user",
			Parts: []clients.GeminiPart{
				{Text: systemPrompt + "\n\nArticle:\n" + article.Content + "\n\nCoreSkills (already executed):\n" + string(collectedJSON)},
			},
		},
	}

	var finalText string

	for step := 0; step < maxLLMSteps; step++ {
		req := clients.GeminiRequest{
			Contents: contents,
			Tools:    tools,
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
		return string(b), buildEvidenceResult("local_search", query, artsToEvidence(arts))
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
		return string(b), buildEvidenceResult("external_search", query, searchResultsToEvidence(items))
	case "search_un":
		return runExternalSiteSearch(ctx, call, "un.org")
	case "search_worldbank":
		return runExternalSiteSearch(ctx, call, "worldbank.org")
	case "search_who":
		return runExternalSiteSearch(ctx, call, "who.int")
	case "search_imf":
		return runExternalSiteSearch(ctx, call, "imf.org")
	case "search_fao":
		return runExternalSiteSearch(ctx, call, "fao.org")
	case "search_oecd":
		return runExternalSiteSearch(ctx, call, "oecd.org")
	case "search_wikipedia":
		return runExternalSiteSearch(ctx, call, "wikipedia.org")
	case "search_openalex":
		query, _ := call.Arguments["query"].(string)
		limit := 5
		if v, ok := call.Arguments["limit"].(float64); ok {
			limit = int(v)
		}
		items, err := external.SearchOpenAlex(ctx, query, limit)
		if err != nil {
			return toolError(err), nil
		}
		b, _ := json.Marshal(map[string]interface{}{
			"count": len(items),
			"items": items,
		})
		return string(b), buildEvidenceResult("openalex", query, searchResultsToEvidence(items))
	case "search_crossref":
		query, _ := call.Arguments["query"].(string)
		limit := 5
		if v, ok := call.Arguments["limit"].(float64); ok {
			limit = int(v)
		}
		items, err := external.SearchCrossref(ctx, query, limit)
		if err != nil {
			return toolError(err), nil
		}
		b, _ := json.Marshal(map[string]interface{}{
			"count": len(items),
			"items": items,
		})
		return string(b), buildEvidenceResult("crossref", query, searchResultsToEvidence(items))
	case "search_semanticscholar":
		query, _ := call.Arguments["query"].(string)
		limit := 5
		if v, ok := call.Arguments["limit"].(float64); ok {
			limit = int(v)
		}
		items, err := external.SearchSemanticScholar(ctx, query, limit)
		if err != nil {
			return toolError(err), nil
		}
		b, _ := json.Marshal(map[string]interface{}{
			"count": len(items),
			"items": items,
		})
		return string(b), buildEvidenceResult("semanticscholar", query, searchResultsToEvidence(items))
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
	case "finance_template":
		name, _ := call.Arguments["name"].(string)
		tpl, err := finance.GetTemplate(name)
		if err != nil {
			return toolError(err), nil
		}
		b, _ := json.Marshal(tpl)
		return string(b), nil
	case "source_weight":
		src, _ := call.Arguments["source"].(string)
		w, tier := finance.SourceWeight(src)
		b, _ := json.Marshal(map[string]interface{}{
			"source": src,
			"weight": w,
			"tier":   tier,
		})
		return string(b), nil
	case "fetch_url":
		raw, _ := call.Arguments["url"].(string)
		page, err := external.FetchURL(raw)
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

func runExternalSiteSearch(ctx context.Context, call llmToolCall, site string) (string, *skill.Result) {
	query, _ := call.Arguments["query"].(string)
	limit := 5
	if v, ok := call.Arguments["limit"].(float64); ok {
		limit = int(v)
	}
	items, err := external.SearchWithSite(ctx, query, site, limit)
	if err != nil {
		return toolError(err), nil
	}
	out := map[string]interface{}{
		"count": len(items),
		"items": items,
		"site":  site,
	}
	b, _ := json.Marshal(out)
	return string(b), buildEvidenceResult("external_search", site, searchResultsToEvidence(items))
}

func buildEvidenceResult(source, summary string, evidence []skill.Evidence) *skill.Result {
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

func artsToEvidence(arts []model.Article) []skill.Evidence {
	res := make([]skill.Evidence, 0, len(arts))
	for i, a := range arts {
		if i >= 3 {
			break
		}
		res = append(res, skill.Evidence{
			Type:    "local",
			Source:  a.Title,
			URL:     a.URL,
			Excerpt: excerpt(a.Content, 160),
		})
	}
	return res
}

func searchResultsToEvidence(items []external.SearchResult) []skill.Evidence {
	res := make([]skill.Evidence, 0, len(items))
	for i, it := range items {
		if i >= 3 {
			break
		}
		res = append(res, skill.Evidence{
			Type:    it.Source,
			Source:  it.Title,
			URL:     it.URL,
			Excerpt: excerpt(it.Snippet, 160),
		})
	}
	return res
}

func canonicalToEvidence(items []canonical.Ref) []skill.Evidence {
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
