package kv

import (
	"context"
	"github.com/go-redis/redis/v8"
)

var (
	// Rdb is the redis client
	Rdb *redis.Client
	Ctx = context.Background()
)

// InitRedis initializes the redis client
func InitRedis() {
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

// StopRedis closes the redis client
func StopRedis() {
	if Rdb != nil {
		Rdb.Close()
	}
}
