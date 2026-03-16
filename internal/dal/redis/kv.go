package redis

import (
	"context"

	"github.com/go-redis/redis/v8"
)

var (
	// Rdb 是 Redis 客户端实例。
	Rdb *redis.Client
	Ctx = context.Background()
)

// Init initializes the redis client
func Init() {
	Rdb = redis.NewClient(&redis.Options{
		Addr:     "localhost:6379", // Corresponds to the port mapping in docker-compose.yaml
		Password: "",               // No password set
		DB:       0,                // Use default DB
	})

	// Check the connection
	_, err := Rdb.Ping(Ctx).Result()
	if err != nil {
		panic("failed to connect redis")
	}
}

// Stop closes the redis client
func Stop() {
	if Rdb != nil {
		Rdb.Close()
	}
}
