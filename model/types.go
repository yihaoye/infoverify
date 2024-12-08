package model

type Data struct {
	ID   string `json:"id"`
	Type string `json:"type"`
	Time string `json:"time"`
}

func (d *Data) GetTime() string {
	return d.Time
}

type EventType int

const (
	Unknown EventType = 0
	Create  EventType = 1
	Update  EventType = 2
)

type Event struct {
	Type EventType `json:"type"`
}
