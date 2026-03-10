package clients

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"time"
)

type GeminiClient struct {
	apiKey     string
	baseURL    string
	httpClient *http.Client
}

func NewGeminiClient() (*GeminiClient, error) {
	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		return nil, errors.New("GEMINI_API_KEY is not set")
	}
	baseURL := os.Getenv("GEMINI_BASE_URL")
	if baseURL == "" {
		baseURL = "https://generativelanguage.googleapis.com/v1beta"
	}
	return &GeminiClient{
		apiKey:  apiKey,
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}, nil
}

type GeminiPart struct {
	Text             string            `json:"text,omitempty"`
	FunctionCall     *GeminiFuncCall   `json:"functionCall,omitempty"`
	FunctionResponse *GeminiFuncResp   `json:"functionResponse,omitempty"`
}

type GeminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []GeminiPart `json:"parts"`
}

type GeminiFuncCall struct {
	Name string                 `json:"name"`
	Args map[string]interface{} `json:"args"`
}

type GeminiFuncResp struct {
	Name     string                 `json:"name"`
	Response map[string]interface{} `json:"response"`
}

type GeminiTool struct {
	FunctionDeclarations []GeminiFuncDecl `json:"function_declarations,omitempty"`
}

type GeminiFuncDecl struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description,omitempty"`
	Parameters  map[string]interface{} `json:"parameters,omitempty"`
}

type GeminiRequest struct {
	Contents []GeminiContent `json:"contents"`
	Tools    []GeminiTool    `json:"tools,omitempty"`
	GenerationConfig map[string]interface{} `json:"generationConfig,omitempty"`
}

type GeminiResponse struct {
	Candidates []struct {
		Content GeminiContent `json:"content"`
	} `json:"candidates"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func (c *GeminiClient) GenerateContent(ctx context.Context, model string, req GeminiRequest) (GeminiResponse, error) {
	if model == "" {
		return GeminiResponse{}, errors.New("model is empty")
	}
	body, err := json.Marshal(req)
	if err != nil {
		return GeminiResponse{}, fmt.Errorf("marshal request: %w", err)
	}

	url := fmt.Sprintf("%s/models/%s:generateContent?key=%s", c.baseURL, model, c.apiKey)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return GeminiResponse{}, fmt.Errorf("build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return GeminiResponse{}, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var errBody GeminiResponse
		_ = json.NewDecoder(resp.Body).Decode(&errBody)
		if errBody.Error != nil && errBody.Error.Message != "" {
			return GeminiResponse{}, fmt.Errorf("gemini error: %s", errBody.Error.Message)
		}
		return GeminiResponse{}, fmt.Errorf("gemini http status: %s", resp.Status)
	}

	var data GeminiResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return GeminiResponse{}, fmt.Errorf("decode response: %w", err)
	}
	return data, nil
}

func ExtractText(resp GeminiResponse) string {
	if len(resp.Candidates) == 0 {
		return ""
	}
	parts := resp.Candidates[0].Content.Parts
	for _, p := range parts {
		if p.Text != "" {
			return p.Text
		}
	}
	return ""
}

func ExtractFunctionCalls(resp GeminiResponse) []GeminiFuncCall {
	if len(resp.Candidates) == 0 {
		return nil
	}
	parts := resp.Candidates[0].Content.Parts
	calls := make([]GeminiFuncCall, 0)
	for _, p := range parts {
		if p.FunctionCall != nil {
			calls = append(calls, *p.FunctionCall)
		}
	}
	return calls
}
