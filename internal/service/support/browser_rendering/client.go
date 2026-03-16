package browser_rendering

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

type markdownResponse struct {
	Success bool   `json:"success"`
	Result  string `json:"result"`
	Errors  []struct {
		Message string `json:"message"`
	} `json:"errors"`
	Messages []struct {
		Message string `json:"message"`
	} `json:"messages"`
}

func Configured() bool {
	// 必要配置：账号 ID + API Token。
	return os.Getenv("CF_BR_ACCOUNT_ID") != "" && os.Getenv("CF_BR_API_TOKEN") != ""
}

func FetchMarkdown(ctx context.Context, rawURL string) (string, error) {
	// 调用 Cloudflare Browser Rendering /markdown，返回可解析的 Markdown。
	account := os.Getenv("CF_BR_ACCOUNT_ID")
	token := os.Getenv("CF_BR_API_TOKEN")
	if account == "" || token == "" {
		return "", errors.New("cloudflare browser rendering not configured")
	}
	base := os.Getenv("CF_BR_BASE_URL")
	if base == "" {
		base = "https://api.cloudflare.com/client/v4"
	}

	// 只传入 URL，交由 Cloudflare 完成渲染/抽取。
	payload := map[string]interface{}{
		"url": rawURL,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	endpoint := fmt.Sprintf("%s/accounts/%s/browser-rendering/markdown", base, account)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 25 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("browser rendering request: %w", err)
	}
	defer resp.Body.Close()

	var out markdownResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || !out.Success {
		msg := "browser rendering failed"
		if len(out.Errors) > 0 && out.Errors[0].Message != "" {
			msg = out.Errors[0].Message
		}
		return "", fmt.Errorf("%s (status %s)", msg, resp.Status)
	}
	return out.Result, nil
}
