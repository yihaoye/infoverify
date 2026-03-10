package dal

import (
	"log"

	"github.com/yihaoye/infoverify/internal/dal/kv"
	"github.com/yihaoye/infoverify/internal/dal/postgres"
)

func Init() {
	kv.InitRedis()
	if err := postgres.Init(); err != nil {
		log.Fatalf("failed to init postgres: %v", err)
	}
}

func Stop() {
	kv.StopRedis()
	postgres.Stop()
	// xxx.Close()
}
