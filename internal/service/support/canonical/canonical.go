package canonical

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
)

type Ref struct {
	Domain string `json:"domain"`
	Title  string `json:"title"`
	Author string `json:"author"`
	Year   int    `json:"year"`
	Note   string `json:"note"`
	URL    string `json:"url"`
}

func LoadAll() ([]Ref, error) {
	b, err := os.ReadFile("internal/service/support/canonical/refs.json")
	if err != nil {
		return nil, err
	}
	var refs []Ref
	if err := json.Unmarshal(b, &refs); err != nil {
		return nil, err
	}
	return refs, nil
}

func FilterByDomain(domain string) ([]Ref, error) {
	if domain == "" {
		return nil, errors.New("domain is empty")
	}
	refs, err := LoadAll()
	if err != nil {
		return nil, err
	}
	domain = strings.ToLower(strings.TrimSpace(domain))
	res := make([]Ref, 0)
	for _, r := range refs {
		if strings.ToLower(r.Domain) == domain {
			res = append(res, r)
		}
	}
	return res, nil
}

func SearchByKeyword(keyword string, limit int) ([]Ref, error) {
	if keyword == "" {
		return nil, errors.New("keyword is empty")
	}
	refs, err := LoadAll()
	if err != nil {
		return nil, err
	}
	keyword = strings.ToLower(keyword)
	res := make([]Ref, 0)
	for _, r := range refs {
		if strings.Contains(strings.ToLower(r.Title), keyword) || strings.Contains(strings.ToLower(r.Note), keyword) {
			res = append(res, r)
			if limit > 0 && len(res) >= limit {
				break
			}
		}
	}
	return res, nil
}
