package dal

import "github.com/yihaoye/infoverify/dal/cache"

func Init() {
	cache.Init()
	// search.Init()
}

func Stop() {
	// xxx.Close()
}
