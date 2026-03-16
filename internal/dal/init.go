package dal

import (
	"log"

	"github.com/yihaoye/infoverify/internal/dal/postgres"
	"github.com/yihaoye/infoverify/internal/dal/redis"
)

func Init() {
	// 初始化依赖：Redis 队列 + Postgres 存储。
	redis.Init()
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
