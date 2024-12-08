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
	// request-respond pattern
	case "server":
		runServer()
	case "webhook":
		runCallback()
	// batch pattern
	case "cron":
		runCron()
	case "batch":
		runBatch()
	// event-driven pattern
	case "event", "stream":
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

func runCallback() {
	// webhook.Run()
}

func runCron() {
	// cron.Run()
}

func runBatch() {
	// batch.Run()
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
