package cache

import (
	"github.com/go-redis/redis/v8"
)

var (
	RedisClient *redis.Client
)

func Init() {
	RedisClient = redis.NewClient(&redis.Options{
		Addr:     "http://localhost:6379",
		Password: "",
		DB:       0,
		PoolSize: 10,
	})
}
