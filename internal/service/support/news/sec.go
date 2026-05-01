package news

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	secTickersURL = "https://www.sec.gov/files/company_tickers.json"
	secDataBase   = "https://data.sec.gov/submissions/"
	secArchives   = "https://www.sec.gov/Archives/edgar/data/"
)

type secTickerEntry struct {
	CIKStr int    `json:"cik_str"`
	Ticker string `json:"ticker"`
	Title  string `json:"title"`
}

type secTickerCache struct {
	once sync.Once
	mu   sync.RWMutex
	err  error
	byTk map[string]int
}

var tickers secTickerCache

func ensureSECTickers(ctx context.Context) error {
	tickers.once.Do(func() {
		tickers.byTk = make(map[string]int)
		ua := secUserAgent()
		if ua == "" {
			tickers.err = fmt.Errorf("SEC_USER_AGENT is not set")
			return
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, secTickersURL, nil)
		if err != nil {
			tickers.err = err
			return
		}
		req.Header.Set("User-Agent", ua)
		req.Header.Set("Accept", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			tickers.err = err
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			tickers.err = fmt.Errorf("sec tickers http status: %s", resp.Status)
			return
		}
		// The JSON is an object keyed by index: {"0":{cik_str,...}, "1":{...}}
		raw := map[string]secTickerEntry{}
		if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
			tickers.err = err
			return
		}
		for _, e := range raw {
			if e.Ticker == "" || e.CIKStr == 0 {
				continue
			}
			tickers.byTk[strings.ToUpper(strings.TrimSpace(e.Ticker))] = e.CIKStr
		}
	})
	tickers.mu.RLock()
	defer tickers.mu.RUnlock()
	return tickers.err
}

func lookupCIK(ticker string) (int, bool) {
	tickers.mu.RLock()
	defer tickers.mu.RUnlock()
	cik, ok := tickers.byTk[strings.ToUpper(strings.TrimSpace(ticker))]
	return cik, ok
}

func SearchSECFilings(ctx context.Context, ticker string, limit int) ([]Item, error) {
	ticker = strings.TrimSpace(ticker)
	if ticker == "" {
		return nil, fmt.Errorf("ticker is empty")
	}
	if limit <= 0 {
		limit = 10
	}
	if limit > 50 {
		limit = 50
	}

	if err := ensureSECTickers(ctx); err != nil {
		return nil, err
	}
	cik, ok := lookupCIK(ticker)
	if !ok {
		return nil, fmt.Errorf("unknown ticker: %s", ticker)
	}

	ua := secUserAgent()
	if ua == "" {
		return nil, fmt.Errorf("SEC_USER_AGENT is not set")
	}

	submissionsURL := secDataBase + "CIK" + fmt.Sprintf("%010d", cik) + ".json"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, submissionsURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", ua)
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("sec submissions http status: %s", resp.Status)
	}

	var data struct {
		Name    string `json:"name"`
		Filings struct {
			Recent struct {
				AccessionNumber []string `json:"accessionNumber"`
				FilingDate      []string `json:"filingDate"`
				Form            []string `json:"form"`
				PrimaryDocument []string `json:"primaryDocument"`
				PrimaryDocDesc  []string `json:"primaryDocDescription"`
			} `json:"recent"`
		} `json:"filings"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}

	type row struct {
		acc  string
		date string
		form string
		doc  string
		desc string
	}
	rows := make([]row, 0, len(data.Filings.Recent.AccessionNumber))
	for i, acc := range data.Filings.Recent.AccessionNumber {
		r := row{acc: acc}
		if i < len(data.Filings.Recent.FilingDate) {
			r.date = data.Filings.Recent.FilingDate[i]
		}
		if i < len(data.Filings.Recent.Form) {
			r.form = data.Filings.Recent.Form[i]
		}
		if i < len(data.Filings.Recent.PrimaryDocument) {
			r.doc = data.Filings.Recent.PrimaryDocument[i]
		}
		if i < len(data.Filings.Recent.PrimaryDocDesc) {
			r.desc = data.Filings.Recent.PrimaryDocDesc[i]
		}
		rows = append(rows, r)
	}

	// Filter to the most common "news-like" filings first.
	keepForms := map[string]bool{
		"8-K":  true,
		"10-Q": true,
		"10-K": true,
		"6-K":  true,
		"20-F": true,
	}

	items := make([]Item, 0, limit)
	for _, r := range rows {
		if len(items) >= limit {
			break
		}
		form := strings.ToUpper(strings.TrimSpace(r.form))
		if form != "" && !keepForms[form] {
			continue
		}
		title := strings.TrimSpace(strings.Join([]string{ticker, form, r.desc}, " "))
		title = strings.Join(strings.Fields(title), " ")

		u := buildSECFilingURL(cik, r.acc, r.doc)
		items = append(items, Item{
			Title:       title,
			URL:         u,
			Source:      "sec.gov",
			PublishedAt: parseSECFilingDate(r.date),
			Provider:    "sec",
			Snippet:     firstNonEmpty(r.desc, data.Name),
		})
	}

	// Sort newest first when we have parsed dates.
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].PublishedAt.After(items[j].PublishedAt)
	})

	return items, nil
}

func buildSECFilingURL(cik int, accessionWithDashes, primaryDoc string) string {
	// Filings live under: /Archives/edgar/data/{cik}/{accessionNoDashes}/...
	// Prefer primary document when present, otherwise fall back to the "-index.html" page.
	accNoDashes := strings.ReplaceAll(accessionWithDashes, "-", "")
	if primaryDoc != "" {
		return secArchives + strconv.Itoa(cik) + "/" + accNoDashes + "/" + url.PathEscape(primaryDoc)
	}
	if accessionWithDashes != "" {
		return secArchives + strconv.Itoa(cik) + "/" + accNoDashes + "/" + url.PathEscape(accessionWithDashes) + "-index.html"
	}
	return secArchives + strconv.Itoa(cik)
}

func parseSECFilingDate(s string) time.Time {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}
	}
	// filingDate is usually YYYY-MM-DD.
	t, err := time.ParseInLocation("2006-01-02", s, time.UTC)
	if err != nil {
		return time.Time{}
	}
	return t
}

func secUserAgent() string {
	// SEC requests explicitly ask for a declared User-Agent with contact info.
	if v := strings.TrimSpace(os.Getenv("SEC_USER_AGENT")); v != "" {
		return v
	}
	// Fallback: do not silently send empty UA; the caller can choose to disable SEC.
	return ""
}
