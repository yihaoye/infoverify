package dal

import (
	"log"

	"github.com/yihaoye/infoverify/internal/dal/postgres"
	"github.com/yihaoye/infoverify/internal/dal/redis"
)

func Init() {
	// Backward-compatible default: require all dependencies.
	InitWorker()
}

func InitServer() {
	// Server can run in a degraded mode: score API does not require DB/Redis.
	if err := redis.Init(); err != nil {
		log.Printf("redis not configured (some endpoints will be unavailable): %v", err)
	}
	if err := postgres.Init(); err != nil {
		log.Printf("postgres not configured (some endpoints will be unavailable): %v", err)
	}
}

func InitWorker() {
	// Worker requires Redis queue + Postgres storage.
	if err := redis.Init(); err != nil {
		log.Fatalf("failed to init redis: %v", err)
	}
	if err := postgres.Init(); err != nil {
		log.Fatalf("failed to init postgres: %v", err)
	}
}

func Stop() {
	// 优雅关闭连接。
	redis.Stop()
	postgres.Stop()
	// xxx.Close()
}
