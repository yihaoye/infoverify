package llm_assess

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/yihaoye/infoverify/internal/clients"
)

type Assessment struct {
	Enabled    bool     `json:"enabled"`
	Error      string   `json:"error,omitempty"`
	Verdict    string   `json:"verdict,omitempty"`    // high|medium|low|unclear
	Confidence float64  `json:"confidence,omitempty"` // 0..1
	Rationale  string   `json:"rationale,omitempty"`
	Flags      []string `json:"flags,omitempty"`
	Model      string   `json:"model,omitempty"`
}

func AssessCredibility(ctx context.Context, text string) (Assessment, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return Assessment{Enabled: false, Error: "empty text"}, errors.New("empty text")
	}
	if os.Getenv("GEMINI_API_KEY") == "" {
		return Assessment{Enabled: false, Error: "GEMINI_API_KEY is not set"}, errors.New("GEMINI_API_KEY is not set")
	}

	client, err := clients.NewGeminiClient()
	if err != nil {
		return Assessment{Enabled: false, Error: err.Error()}, err
	}

	modelName := os.Getenv("GEMINI_MODEL")
	if modelName == "" {
		modelName = "gemini-2.5-flash"
	}

	prompt := buildPrompt(text)
	req := clients.GeminiRequest{
		Contents: []clients.GeminiContent{
			{
				Role: "user",
				Parts: []clients.GeminiPart{
					{Text: prompt},
				},
			},
		},
		GenerationConfig: map[string]interface{}{"temperature": 0.1},
	}

	resp, err := client.GenerateContent(ctx, modelName, req)
	if err != nil {
		return Assessment{Enabled: true, Error: err.Error(), Model: modelName}, err
	}
	raw := strings.TrimSpace(clients.ExtractText(resp))

	assess := Assessment{Enabled: true, Model: modelName}
	if raw == "" {
		assess.Error = "empty model output"
		return assess, fmt.Errorf("empty model output")
	}

	// Expect JSON; tolerate accidental wrapping.
	raw = strings.TrimPrefix(raw, "```json")
	raw = strings.TrimPrefix(raw, "```")
	raw = strings.TrimSuffix(raw, "```")
	raw = strings.TrimSpace(raw)

	var parsed struct {
		Verdict    string   `json:"verdict"`
		Confidence float64  `json:"confidence"`
		Rationale  string   `json:"rationale"`
		Flags      []string `json:"flags"`
	}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		assess.Verdict = "unclear"
		assess.Confidence = 0.0
		assess.Rationale = truncate(raw, 600)
		assess.Flags = []string{"model_output_not_json"}
		return assess, nil
	}

	assess.Verdict = normalizeVerdict(parsed.Verdict)
	assess.Confidence = clamp(parsed.Confidence, 0, 1)
	assess.Rationale = strings.TrimSpace(parsed.Rationale)
	assess.Flags = parsed.Flags
	return assess, nil
}

func buildPrompt(text string) string {
	// Keep this separate from the three principles: this is a standalone LLM "credibility" view.
	// It MUST NOT hallucinate external facts; it can only evaluate internal cues and uncertainty.
	return "You are assessing the credibility of a single piece of text. " +
		"You must NOT assume any external facts or browse the web. " +
		"Judge credibility only from internal cues (specificity, sourcing language, numbers, consistency, hedging, sensationalism, unverifiable claims). " +
		"Write `rationale` and `flags` in Simplified Chinese. " +
		"Return STRICT JSON ONLY, with this schema:\n" +
		"{\"verdict\":\"high|medium|low|unclear\",\"confidence\":0-1,\"rationale\":\"一段简短中文说明\",\"flags\":[\"中文标签...\"]}\n\n" +
		"Text:\n" + text
}

func normalizeVerdict(v string) string {
	v = strings.ToLower(strings.TrimSpace(v))
	switch v {
	case "high", "medium", "low", "unclear":
		return v
	default:
		return "unclear"
	}
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func truncate(s string, max int) string {
	if max <= 0 {
		return ""
	}
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}
