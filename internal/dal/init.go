package dal

import (
	"log"

	"github.com/yihaoye/infoverify/internal/dal/postgres"
)

func Init() {
	// Backward-compatible default: require all dependencies.
	InitServer()
}

func InitServer() {
	// Server can run in a degraded mode: score API does not require DB.
	if err := postgres.Init(); err != nil {
		log.Printf("postgres not configured (some endpoints will be unavailable): %v", err)
	}
}

func Stop() {
	// 优雅关闭连接。
	postgres.Stop()
	// xxx.Close()
}
