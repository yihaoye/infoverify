package event

import (
	"context"

	"github.com/yihaoye/infoverify/model"
)

// var producer = kafka.NewProducer("localhost:9092")
// var consumer = kafka.NewConsumer("localhost:9092")
// var topic = "event"
// var group = "event_group"
// var logger = log.NewLogger("event")

type EventHandler struct {
}

type EventHandlerImpl interface {
	Handle(ctx context.Context, ev *model.Event) error
}

func NewEventHandler() *EventHandler {
	return &EventHandler{}
}

func (h *EventHandler) Handle(ctx context.Context, ev *model.Event) error {
	// b, err := ev.Unmarshal()
	// if err != nil {
	// 	return err
	// }

	switch ev.Type {
	case model.Create:
		// ...
	default:
		// ...
	}
	return nil
}
