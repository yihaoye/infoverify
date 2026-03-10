package external

import "strings"

func AllowedDomains() map[string]struct{} {
	list := []string{
		"un.org",
		"data.un.org",
		"worldbank.org",
		"data.worldbank.org",
		"imf.org",
		"who.int",
		"fao.org",
		"oecd.org",
		"stats.gov.cn",
		"statista.com",
		"ourworldindata.org",
		"wikipedia.org",
		"openalex.org",
		"api.openalex.org",
		"semanticscholar.org",
		"api.semanticscholar.org",
		"crossref.org",
		"api.crossref.org",
	}
	m := make(map[string]struct{}, len(list))
	for _, d := range list {
		m[strings.ToLower(d)] = struct{}{}
	}
	return m
}

func IsAllowedHost(host string) bool {
	host = strings.ToLower(host)
	if host == "" {
		return false
	}
	allowed := AllowedDomains()
	if _, ok := allowed[host]; ok {
		return true
	}
	// allow subdomains
	for d := range allowed {
		if strings.HasSuffix(host, "."+d) {
			return true
		}
	}
	return false
}
