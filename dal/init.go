package dal

import (
	"github.com/yihaoye/infoverify/dal/cache"
	"github.com/yihaoye/infoverify/dal/semantics_search"
)

func Init() {
	cache.Init()
	semantics_search.Init()
}

func Stop() {
	// xxx.Close()
}
