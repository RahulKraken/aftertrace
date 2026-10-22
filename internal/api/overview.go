package api

import (
	"database/sql"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/RahulKraken/aftertrace/internal/analysis"
	"github.com/RahulKraken/aftertrace/internal/rules"
)

const day = int64(24 * time.Hour)

// bdCache keeps each trace's painted time split. A trace is recomputed only
// when its span count or last end time changes, so a running turn refreshes
// and finished turns are computed once.
type bdCache struct {
	mu sync.Mutex
	m  map[string]bdEntry
}

type bdEntry struct {
	n   int
	end int64
	bd  map[string]float64
}

var breakdowns = &bdCache{m: map[string]bdEntry{}}

type traceStat struct {
	n   int
	end int64
}

// traceStats returns span count and last end per trace, in one query.
func traceStats(db *sql.DB) (map[string]traceStat, error) {
	rows, err := db.Query(`SELECT trace_id, count(*), max(end_ns) FROM spans GROUP BY 1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]traceStat{}
	for rows.Next() {
		var t string
		var s traceStat
		if err := rows.Scan(&t, &s.n, &s.end); err != nil {
			return nil, err
		}
		out[t] = s
	}
	return out, rows.Err()
}

func (c *bdCache) get(db *sql.DB, tid string, st traceStat) map[string]float64 {
	key := fmt.Sprintf("%p/%s", db, tid)
	c.mu.Lock()
	e, ok := c.m[key]
	c.mu.Unlock()
	if ok && e.n == st.n && e.end == st.end {
		return e.bd
	}
	spans, err := analysis.SpanRows(db, tid)
	if err != nil {
		return nil
	}
	bd := analysis.Breakdown(db, tid, spans)
	c.mu.Lock()
	c.m[key] = bdEntry{n: st.n, end: st.end, bd: bd}
	c.mu.Unlock()
	return bd
}

type turnRow struct {
	trace, session string
	start, end     int64
	durMS          float64
	pending        bool
}

func turnRows(db *sql.DB, lo, hi int64) ([]turnRow, error) {
	rows, err := db.Query(`SELECT trace_id, coalesce(session_id,''), start_ns, end_ns, duration_ms, in_progress
		FROM turn_roots WHERE start_ns >= ? AND start_ns < ? ORDER BY start_ns`, lo, hi)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []turnRow
	for rows.Next() {
		var r turnRow
		if err := rows.Scan(&r.trace, &r.session, &r.start, &r.end, &r.durMS, &r.pending); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

type window struct {
	Sessions   int                `json:"sessions"`
	Turns      int                `json:"turns"`
	TurnMS     float64            `json:"turn_ms"`
	Breakdown  map[string]float64 `json:"breakdown"`
	CostUSD    float64            `json:"cost_usd"`
	Requests   int                `json:"requests"`
	Tokens     float64            `json:"tokens"`
	CacheHit   *float64           `json:"cache_hit"`
	LinesAdded float64            `json:"lines_added"`
	LinesRem   float64            `json:"lines_removed"`
	Commits    float64            `json:"commits"`
	PRs        float64            `json:"pull_requests"`
	ActiveS    float64            `json:"active_s"`
	ToolCalls  int                `json:"tool_calls"`
	Approvals  int                `json:"approvals"`
	Errors     int                `json:"errors"`
}

func summarize(db *sql.DB, stats map[string]traceStat, lo, hi int64) (window, []turnRow, error) {
	w := window{Breakdown: map[string]float64{}}
	turns, err := turnRows(db, lo, hi)
	if err != nil {
		return w, nil, err
	}
	sess := map[string]bool{}
	for _, t := range turns {
		w.Turns++
		w.TurnMS += t.durMS
		if t.session != "" {
			sess[t.session] = true
		}
		for k, v := range breakdowns.get(db, t.trace, stats[t.trace]) {
			w.Breakdown[k] += v
		}
	}
	w.Sessions = len(sess)
	var cost, tokens, hit sql.NullFloat64
	if err := db.QueryRow(`SELECT sum(cost_usd), count(*), sum(input_tokens+output_tokens+cache_read_tokens+cache_creation_tokens),
		sum(cache_read_tokens)/nullif(sum(cache_read_tokens+cache_creation_tokens+input_tokens),0)
		FROM llm WHERE start_ns >= ? AND start_ns < ?`, lo, hi).Scan(&cost, &w.Requests, &tokens, &hit); err != nil {
		return w, nil, err
	}
	w.CostUSD, w.Tokens = cost.Float64, tokens.Float64
	if hit.Valid {
		v := hit.Float64
		w.CacheHit = &v
	}
	var added, removed, commits, prs, active sql.NullFloat64
	if err := db.QueryRow(`SELECT
		sum(value) FILTER (WHERE name='claude_code.lines_of_code.count' AND a(attrs,'type')='added'),
		sum(value) FILTER (WHERE name='claude_code.lines_of_code.count' AND a(attrs,'type')='removed'),
		sum(value) FILTER (WHERE name='claude_code.commit.count'),
		sum(value) FILTER (WHERE name='claude_code.pull_request.count'),
		sum(value) FILTER (WHERE name='claude_code.active_time.total')
		FROM metric_points WHERE ts_ns >= ? AND ts_ns < ?`, lo, hi).Scan(&added, &removed, &commits, &prs, &active); err != nil {
		return w, nil, err
	}
	w.LinesAdded, w.LinesRem, w.Commits, w.PRs, w.ActiveS = added.Float64, removed.Float64, commits.Float64, prs.Float64, active.Float64
	if err := db.QueryRow(`SELECT count(*), count(*) FILTER (WHERE wait_ms IS NOT NULL AND decision_source IN ('user_temporary','user_permanent'))
		FROM tools WHERE start_ns >= ? AND start_ns < ?`, lo, hi).Scan(&w.ToolCalls, &w.Approvals); err != nil {
		return w, nil, err
	}
	if err := db.QueryRow(`SELECT count(*) FROM spans WHERE is_error AND start_ns >= ? AND start_ns < ?`, lo, hi).Scan(&w.Errors); err != nil {
		return w, nil, err
	}
	return w, turns, nil
}

type dayPoint struct {
	Day     string  `json:"day"`
	StartNS int64   `json:"start_ns"`
	CostUSD float64 `json:"cost_usd"`
	TurnMS  float64 `json:"turn_ms"`
	WaitMS  float64 `json:"wait_ms"`
	Turns   int     `json:"turns"`
}

type liveLane struct {
	SessionID string  `json:"session_id"`
	TraceID   string  `json:"trace_id"`
	Title     *string `json:"title"`
	Source    string  `json:"source"`
	StartNS   int64   `json:"start_ns"`
	LastNS    int64   `json:"last_ns"`
	Spans     int     `json:"spans"`
	CostUSD   float64 `json:"cost_usd"`
	Doing     string  `json:"doing"`
	Quiet     bool    `json:"quiet"`
}

// liveLanes lists turns still in progress that received spans in the last
// five minutes. "doing" is the most recent span; "quiet" means nothing new
// for 90 seconds (the agent is thinking, running something long, or waiting).
func liveLanes(db *sql.DB, now int64) ([]liveLane, error) {
	rows, err := db.Query(`SELECT trace_id, coalesce(session_id,''), start_ns, end_ns FROM turn_roots
		WHERE in_progress AND end_ns > ? ORDER BY start_ns`, now-int64(5*time.Minute))
	if err != nil {
		return nil, err
	}
	var lanes []liveLane
	for rows.Next() {
		var l liveLane
		if err := rows.Scan(&l.TraceID, &l.SessionID, &l.StartNS, &l.LastNS); err != nil {
			rows.Close()
			return nil, err
		}
		lanes = append(lanes, l)
	}
	rows.Close()
	for i := range lanes {
		l := &lanes[i]
		var cost sql.NullFloat64
		_ = db.QueryRow(`SELECT count(*) FROM spans WHERE trace_id=?`, l.TraceID).Scan(&l.Spans)
		_ = db.QueryRow(`SELECT sum(cost_usd) FROM llm WHERE trace_id=?`, l.TraceID).Scan(&cost)
		l.CostUSD = cost.Float64
		var name, attrs, res string
		if err := db.QueryRow(`SELECT name, attrs::VARCHAR, coalesce(resource::VARCHAR,'{}') FROM spans WHERE trace_id=?
			AND name IN ('claude_code.tool','claude_code.llm_request','claude_code.hook') ORDER BY end_ns DESC LIMIT 1`, l.TraceID).
			Scan(&name, &attrs, &res); err == nil {
			l.Doing = doing(name, parseObj(attrs))
			l.Source = sourceName(parseObj(res))
		}
		if p, err := turnPrompt(db, l.TraceID); err == nil && p.Valid {
			t := clipLabel(p.String)
			l.Title = &t
		}
		l.Quiet = now-l.LastNS > int64(90*time.Second)
	}
	return lanes, nil
}

func doing(name string, a map[string]any) string {
	str := func(k string) string {
		v, _ := a[k].(string)
		return v
	}
	switch name {
	case "claude_code.tool":
		t := str("tool_name")
		target := str("full_command")
		if target == "" {
			target = str("file_path")
		}
		if target == "" {
			target = str("subagent_type")
		}
		if target != "" {
			return t + " · " + clipLabel(target)
		}
		return t
	case "claude_code.llm_request":
		m := strings.TrimPrefix(str("model"), "claude-")
		if m == "" {
			m = "model"
		}
		return m + " · thinking"
	case "claude_code.hook":
		return "hook · " + str("hook_name")
	}
	return name
}

// sourceName is the service that sent a span. Claude Code variants
// (claude-code, claude-code-desktop, ...) all count as Claude Code.
func sourceName(res map[string]any) string {
	s, _ := res["service.name"].(string)
	if s == "" {
		return "unknown"
	}
	return s
}

func (s *Server) getOverview(w http.ResponseWriter, r *http.Request) {
	s.Store.Mu.Lock()
	defer s.Store.Mu.Unlock()
	db := s.db()
	now := time.Now().UnixNano()

	stats, err := traceStats(db)
	if err != nil {
		s.err(w, err, 500)
		return
	}
	// "This week" is the last 7 days. If nothing happened then, anchor on the
	// newest data so an old import still tells a story.
	hi := now
	var latest sql.NullInt64
	_ = db.QueryRow(`SELECT max(end_ns) FROM turn_roots`).Scan(&latest)
	anchored := false
	if latest.Valid && latest.Int64 < now-7*day {
		hi = latest.Int64 + 1
		anchored = true
	}
	lo := hi - 7*day
	cur, turns, err := summarize(db, stats, lo, hi)
	if err != nil {
		s.err(w, err, 500)
		return
	}
	prev, _, err := summarize(db, stats, lo-7*day, lo)
	if err != nil {
		s.err(w, err, 500)
		return
	}

	// Daily series for sparklines: 14 days ending at hi, local midnight boundaries.
	end := time.Unix(0, hi).Local()
	start := time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, end.Location()).AddDate(0, 0, -13)
	days := make([]dayPoint, 14)
	for i := range days {
		d := start.AddDate(0, 0, i)
		days[i] = dayPoint{Day: d.Format("Mon 2 Jan"), StartNS: d.UnixNano()}
	}
	idx := func(ns int64) int {
		for i := len(days) - 1; i >= 0; i-- {
			if ns >= days[i].StartNS {
				return i
			}
		}
		return -1
	}
	all, err := turnRows(db, days[0].StartNS, hi)
	if err != nil {
		s.err(w, err, 500)
		return
	}
	for _, t := range all {
		i := idx(t.start)
		if i < 0 {
			continue
		}
		days[i].Turns++
		days[i].TurnMS += t.durMS
		days[i].WaitMS += breakdowns.get(db, t.trace, stats[t.trace])["permission_wait"]
	}
	if cr, err := db.Query(`SELECT start_ns, coalesce(cost_usd,0) FROM llm WHERE start_ns >= ? AND start_ns < ?`, days[0].StartNS, hi); err == nil {
		for cr.Next() {
			var st int64
			var c float64
			if cr.Scan(&st, &c) == nil {
				if i := idx(st); i >= 0 {
					days[i].CostUSD += c
				}
			}
		}
		cr.Close()
	}
	_ = turns

	lanes, err := liveLanes(db, now)
	if err != nil {
		s.err(w, err, 500)
		return
	}
	if lanes == nil {
		lanes = []liveLane{}
	}
	srcs, err := sources(db, now)
	if err != nil {
		s.err(w, err, 500)
		return
	}

	findings := rules.RunAll(db)
	var top any
	open := 0
	for _, f := range findings {
		if f.Severity == "error" {
			continue
		}
		open++
		if top == nil {
			top = f
		}
	}

	recent, err := sessions(db)
	if err != nil {
		s.err(w, err, 500)
		return
	}
	if len(recent) > 6 {
		recent = recent[:6]
	}

	s.json(w, map[string]any{
		"now":       now,
		"lo":        lo,
		"hi":        hi,
		"anchored":  anchored,
		"week":      cur,
		"prev":      prev,
		"days":      days,
		"live":      lanes,
		"sources":   srcs,
		"top":       top,
		"open":      open,
		"recent":    recent,
		"has_data":  len(stats) > 0 || len(srcs) > 0,
		"generated": time.Now().UnixNano(),
	}, 200)
}

type source struct {
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	Spans   int64  `json:"spans"`
	Events  int64  `json:"events"`
	Metrics int64  `json:"metrics"`
	FirstNS int64  `json:"first_ns"`
	LastNS  int64  `json:"last_ns"`
	Live    bool   `json:"live"`
}

// sources groups everything received by service.name. kind is claude-code for
// any claude-code* service, else app.
func sources(db *sql.DB, now int64) ([]source, error) {
	rows, err := db.Query(`
		WITH r AS (
			SELECT coalesce(json_extract_string(resource, '$."service.name"'), 'unknown') AS svc, 'spans' AS k, start_ns AS t0, end_ns AS t1 FROM spans
			UNION ALL SELECT coalesce(json_extract_string(resource, '$."service.name"'), 'unknown'), 'events', ts_ns, ts_ns FROM events
			UNION ALL SELECT coalesce(json_extract_string(resource, '$."service.name"'), 'unknown'), 'metrics', ts_ns, ts_ns FROM metric_points
		)
		SELECT svc, count(*) FILTER (WHERE k='spans'), count(*) FILTER (WHERE k='events'), count(*) FILTER (WHERE k='metrics'), min(t0), max(t1)
		FROM r GROUP BY svc ORDER BY max(t1) DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []source{}
	for rows.Next() {
		var s source
		if err := rows.Scan(&s.Name, &s.Spans, &s.Events, &s.Metrics, &s.FirstNS, &s.LastNS); err != nil {
			return nil, err
		}
		s.Kind = "app"
		if strings.HasPrefix(s.Name, "claude-code") {
			s.Kind = "claude-code"
		}
		s.Live = now-s.LastNS < int64(5*time.Minute)
		out = append(out, s)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].LastNS > out[j].LastNS })
	return out, rows.Err()
}

func (s *Server) getSources(w http.ResponseWriter, r *http.Request) {
	s.Store.Mu.Lock()
	defer s.Store.Mu.Unlock()
	out, err := sources(s.db(), time.Now().UnixNano())
	if err != nil {
		s.err(w, err, 500)
		return
	}
	s.json(w, map[string]any{"now": time.Now().UnixNano(), "sources": out}, 200)
}
