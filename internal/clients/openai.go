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

type OpenAIClient struct {
	apiKey     string
	baseURL    string
	httpClient *http.Client
}

func NewOpenAIClient() (*OpenAIClient, error) {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		return nil, errors.New("OPENAI_API_KEY is not set")
	}
	baseURL := os.Getenv("OPENAI_BASE_URL")
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	return &OpenAIClient{
		apiKey:  apiKey,
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}, nil
}

type responsesRequest struct {
	Model       string      `json:"model"`
	Input       interface{} `json:"input"`
	Tools       []ToolDef   `json:"tools,omitempty"`
	ToolChoice  interface{} `json:"tool_choice,omitempty"`
	Temperature float64     `json:"temperature,omitempty"`
}

type responsesResponse struct {
	Output []struct {
		Type      string `json:"type"`
		ID        string `json:"id,omitempty"`
		Name      string `json:"name,omitempty"`
		Arguments string `json:"arguments,omitempty"`
		CallID    string `json:"call_id,omitempty"`
		Content   []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content,omitempty"`
	} `json:"output"`
	OutputText string `json:"output_text,omitempty"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error,omitempty"`
}

type ResponsesResponse = responsesResponse

type ToolDef struct {
	Type        string                 `json:"type"`
	Name        string                 `json:"name"`
	Description string                 `json:"description,omitempty"`
	Parameters  map[string]interface{} `json:"parameters"`
	Strict      *bool                  `json:"strict,omitempty"`
}

func (c *OpenAIClient) CreateResponse(ctx context.Context, model string, input interface{}) (string, error) {
	if model == "" {
		return "", errors.New("model is empty")
	}
	body, err := json.Marshal(responsesRequest{
		Model:       model,
		Input:       input,
		Temperature: 0.2,
	})
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/responses", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var errBody responsesResponse
		_ = json.NewDecoder(resp.Body).Decode(&errBody)
		if errBody.Error != nil && errBody.Error.Message != "" {
			return "", fmt.Errorf("openai error: %s", errBody.Error.Message)
		}
		return "", fmt.Errorf("openai http status: %s", resp.Status)
	}

	var data responsesResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}
	return ExtractOutputText(&data)
}

func (c *OpenAIClient) CreateResponseWithTools(ctx context.Context, model string, input interface{}, tools []ToolDef, toolChoice interface{}) (responsesResponse, error) {
	if model == "" {
		return responsesResponse{}, errors.New("model is empty")
	}
	body, err := json.Marshal(responsesRequest{
		Model:       model,
		Input:       input,
		Tools:       tools,
		ToolChoice:  toolChoice,
		Temperature: 0.2,
	})
	if err != nil {
		return responsesResponse{}, fmt.Errorf("marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/responses", bytes.NewReader(body))
	if err != nil {
		return responsesResponse{}, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return responsesResponse{}, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var errBody responsesResponse
		_ = json.NewDecoder(resp.Body).Decode(&errBody)
		if errBody.Error != nil && errBody.Error.Message != "" {
			return responsesResponse{}, fmt.Errorf("openai error: %s", errBody.Error.Message)
		}
		return responsesResponse{}, fmt.Errorf("openai http status: %s", resp.Status)
	}

	var data responsesResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return responsesResponse{}, fmt.Errorf("decode response: %w", err)
	}
	return data, nil
}

func ExtractOutputText(data *responsesResponse) (string, error) {
	if data.OutputText != "" {
		return data.OutputText, nil
	}
	for _, out := range data.Output {
		for _, c := range out.Content {
			if c.Type == "output_text" && c.Text != "" {
				return c.Text, nil
			}
		}
	}
	return "", errors.New("no output text in response")
}
