package dal

import "github.com/yihaoye/infoverify/dal/cache"

func Init() {
	cache.Init()
	// rdbms.Init()
	// es.Init()
}

func Stop() {
	// client.Close()
}
