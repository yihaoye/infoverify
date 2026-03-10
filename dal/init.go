package dal

import (
	"log"

	"github.com/yihaoye/infoverify/dal/kv"
	"github.com/yihaoye/infoverify/dal/semantics_search"
)

func Init() {
	kv.InitRedis()
	if err := semantics_search.Init(); err != nil {
		log.Fatalf("failed to init elasticsearch: %v", err)
	}
}

func Stop() {
	kv.StopRedis()
	// xxx.Close()
}
