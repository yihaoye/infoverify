package finance

import (
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"strings"
)

type Template struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Fields      []string `json:"fields"`
	Output      []string `json:"output"`
}

type Templates map[string]Template

func LoadTemplates() (Templates, error) {
	b, err := os.ReadFile("internal/service/support/finance/templates.json")
	if err != nil {
		return nil, err
	}
	var t Templates
	if err := json.Unmarshal(b, &t); err != nil {
		return nil, err
	}
	return t, nil
}

func GetTemplate(name string) (Template, error) {
	if name == "" {
		return Template{}, errors.New("name is empty")
	}
	t, err := LoadTemplates()
	if err != nil {
		return Template{}, err
	}
	if v, ok := t[name]; ok {
		return v, nil
	}
	return Template{}, errors.New("template not found")
}

// SourceWeight returns a rough credibility weight based on domain.
func SourceWeight(raw string) (float64, string) {
	host := strings.ToLower(strings.TrimSpace(raw))
	if strings.HasPrefix(host, "http://") || strings.HasPrefix(host, "https://") {
		if u, err := url.Parse(host); err == nil {
			host = u.Host
		}
	}
	if host == "" {
		return 0.1, "unknown"
	}

	primary := []string{
		"sec.gov",
		"edgar.sec.gov",
		"cbr.ru",
		"ecb.europa.eu",
		"bankofengland.co.uk",
		"federalreserve.gov",
		"treasury.gov",
		"imf.org",
		"worldbank.org",
		"oecd.org",
		"who.int",
		"data.un.org",
	}
	if matchesHost(host, primary) {
		return 0.9, "primary"
	}

	secondary := []string{
		"nyse.com",
		"nasdaq.com",
		"hkex.com.hk",
		"sse.com.cn",
		"szse.cn",
		"londonstockexchange.com",
		"jpx.co.jp",
	}
	if matchesHost(host, secondary) {
		return 0.7, "secondary"
	}

	tertiary := []string{
		"reuters.com",
		"bloomberg.com",
		"finance.yahoo.com",
		"wsj.com",
		"ft.com",
	}
	if matchesHost(host, tertiary) {
		return 0.4, "tertiary"
	}

	return 0.2, "unknown"
}

func matchesHost(host string, list []string) bool {
	for _, d := range list {
		if host == d || strings.HasSuffix(host, "."+d) {
			return true
		}
	}
	return false
}
