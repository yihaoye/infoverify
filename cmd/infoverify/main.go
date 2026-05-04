package main

import (
	"flag"
	"log"
	"net/http"

	"github.com/yihaoye/infoverify/internal/dal"
	"github.com/yihaoye/infoverify/internal/server"
)

const (
	port = ":8080"
)

var (
	task = flag.String("task", "", "The name of the task")
	mode = flag.String("mode", "server", "The name of the web server")
)

func main() {
	flag.Parse()

	switch *mode {
	case "server": // 请求-响应模式（HTTP 服务）
		runServer()
	// case "worker": // 后台任务模式（抓取与分析）
	// 	runWorker()
	default:
		log.Fatal("Unknown mode")
	}
}

func runServer() {
	dal.InitServer()
	defer dal.Stop()

	// 路由注册并启动 HTTP 服务。
	server.SetupRoutes()
	log.Println("Server started on", port)
	log.Fatal(http.ListenAndServe(port, nil))
}
