package model

type EventType int

const (
	Unknown EventType = 0
	Create  EventType = 1
	Update  EventType = 2
)

type Event struct {
	Type EventType `json:"type"`
}
