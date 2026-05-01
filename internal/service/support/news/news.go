package news

import (
	"context"
	"sort"
	"strings"
)

func Search(ctx context.Context, req SearchRequest) (SearchResponse, error) {
	q := strings.TrimSpace(req.Query)
	if q == "" {
		return SearchResponse{}, errBadReq("query is empty")
	}

	max := req.MaxRecords
	if max <= 0 {
		max = 10
	}

	items := make([]Item, 0, max*2)

	// GDELT broad news coverage (free).
	gd, gdErr := SearchGDELT(ctx, q, req.Timespan, max)
	if gdErr == nil {
		items = append(items, gd...)
	}

	// SEC filings as authoritative "news-like" sources.
	secWarn := ""
	if strings.TrimSpace(req.Ticker) != "" {
		sf, err := SearchSECFilings(ctx, req.Ticker, max)
		if err == nil {
			items = append(items, sf...)
		} else {
			secWarn = "sec disabled: " + err.Error()
		}
	}

	// Sort newest first.
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].PublishedAt.After(items[j].PublishedAt)
	})

	// Hard cap.
	if len(items) > max {
		items = items[:max]
	}

	warn := ""
	if gdErr != nil {
		warn = "gdelt failed: " + gdErr.Error()
	}
	if warn != "" && secWarn != "" {
		warn = warn + "; " + secWarn
	} else if warn == "" {
		warn = secWarn
	}

	return SearchResponse{
		Query:   q,
		Items:   items,
		Warning: warn,
	}, nil
}

type errBadReq string

func (e errBadReq) Error() string { return string(e) }
