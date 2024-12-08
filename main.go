package main

import (
	"flag"
	"log"
	"net/http"

	"github.com/yihaoye/infoverify/dal"
	"github.com/yihaoye/infoverify/server"
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
	case "server": // request-respond pattern
		runServer()
	case "event", "stream": // event-driven pattern, mainly for web crawler
		runWorker()
	default:
		log.Fatal("Unknown mode")
	}
}

func runServer() {
	dal.Init()
	defer dal.Stop()

	server.SetupRoutes()
	log.Fatal(http.ListenAndServe(port, nil))
}

func runWorker() {
	switch *task {
	case "a":
		// a.Run()
	case "b":
		// b.Run()
	default:
		log.Fatal("Unknown task")
	}
}
