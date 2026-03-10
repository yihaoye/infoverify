package server

import (
	"fmt"
	"io/ioutil"
	"net/http"
	"strings"
)

// AuthenticateMiddleware 是一个认证中间件
func AuthenticateMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// 从请求头中获取 Authorization 字段
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			// 如果没有 Authorization 字段，返回 401 错误
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// 检查 Authorization 字段的格式是否正确 (Bearer <token>)
		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			// 如果格式不正确，返回 401 错误
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		token := parts[1]

		// 验证 token，简单的模拟验证（实际应用中应与数据库或身份验证服务对接）
		if validateTokenWithAuthService(token) {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// 认证通过，调用实际的处理函数
		next(w, r)
	}
}

// validateTokenWithAuthService 调用外部身份验证服务来验证 token
func validateTokenWithAuthService(token string) bool {
	// 构造身份验证服务的 URL 或 RPC 调用
	url := fmt.Sprintf("https://auth.example.com/validate?token=%s", token)

	// 创建一个 HTTP 客户端
	client := &http.Client{}

	// 创建一个 GET 请求，向身份验证服务发送请求
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		// 如果创建请求失败，返回 false
		return false
	}

	// 发送请求并获取响应
	resp, err := client.Do(req)
	if err != nil {
		// 如果请求失败，返回 false
		return false
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := ioutil.ReadAll(resp.Body)
	if err != nil || string(body) != "valid" {
		// 如果读取响应体失败，返回 false
		return false
	}

	// 这里只是模拟逻辑，可以根据实际的响应处理
	if resp.StatusCode == http.StatusOK {
		// 假设返回的 JSON 响应表明 token 有效
		return true
	}

	// 如果服务返回 401 或其他错误，说明 token 无效
	return false
}
