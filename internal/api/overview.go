package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/RahulKraken/aftertrace/internal/history"
	"github.com/RahulKraken/aftertrace/internal/rules"
)

const day = int64(24 * time.Hour)

type turnRow struct {
	trace, session string
	start, end     int64
	durMS, cost    float64
	pending        bool
}

func turnRows(db *sql.DB, lo, hi int64) ([]turnRow, error) {
	rows, err := db.Query(`SELECT trace_id, coalesce(session_id,''), start_ns, end_ns, duration_ms, coalesce(cost_usd,0), in_progress
		FROM trace_roots WHERE start_ns >= ? AND start_ns < ? ORDER BY start_ns`, lo, hi)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []turnRow
	for rows.Next() {
		var r turnRow
		if err := rows.Scan(&r.trace, &r.session, &r.start, &r.end, &r.durMS, &r.cost, &r.pending); err != nil {
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

func summarize(db *sql.DB, lo, hi int64) (window, error) {
	w := window{Breakdown: map[string]float64{}}
	var sessions, turns, reqs, errs, tools, appr sql.NullInt64
	var turnMS, cost, tokens, hit, added, removed, commits, prs, active sql.NullFloat64
	if err := db.QueryRow(`SELECT coalesce(sum(sessions),0), coalesce(sum(turns),0), coalesce(sum(turn_ms),0),
		coalesce(sum(cost_usd),0), coalesce(sum(tokens),0), coalesce(sum(requests),0), coalesce(sum(errors),0),
		coalesce(sum(tool_calls),0), coalesce(sum(approvals),0),
		sum(cache_hit * turns)/nullif(sum(turns),0),
		coalesce(sum(lines_added),0), coalesce(sum(lines_removed),0), coalesce(sum(commits),0),
		coalesce(sum(prs),0), coalesce(sum(active_s),0)
		FROM day_stats WHERE day_start_ns < ? AND day_start_ns + ? > ?`, hi, day, lo).Scan(
		&sessions, &turns, &turnMS, &cost, &tokens, &reqs, &errs, &tools, &appr, &hit,
		&added, &removed, &commits, &prs, &active); err != nil {
		return w, err
	}
	w.Sessions = int(sessions.Int64)
	w.Turns = int(turns.Int64)
	w.TurnMS = turnMS.Float64
	w.CostUSD = cost.Float64
	w.Tokens = tokens.Float64
	w.Requests = int(reqs.Int64)
	w.Errors = int(errs.Int64)
	w.ToolCalls = int(tools.Int64)
	w.Approvals = int(appr.Int64)
	if hit.Valid {
		v := hit.Float64
		w.CacheHit = &v
	}
	w.LinesAdded, w.LinesRem, w.Commits, w.PRs, w.ActiveS = added.Float64, removed.Float64, commits.Float64, prs.Float64, active.Float64
	rows, err := db.Query(`SELECT coalesce(breakdown::VARCHAR,'{}') FROM day_stats WHERE day_start_ns < ? AND day_start_ns + ? > ?`, hi, day, lo)
	if err != nil {
		return w, err
	}
	defer rows.Close()
	for rows.Next() {
		var bjs string
		if rows.Scan(&bjs) != nil {
			continue
		}
		var bd map[string]float64
		_ = json.Unmarshal([]byte(bjs), &bd)
		for k, v := range bd {
			w.Breakdown[k] += v
		}
	}
	return w, rows.Err()
}

type modelSpend struct {
	Model   string  `json:"model"`
	CostUSD float64 `json:"cost_usd"`
	Tokens  float64 `json:"tokens,omitempty"`
}

type dayPoint struct {
	Day     string       `json:"day"`
	StartNS int64        `json:"start_ns"`
	CostUSD float64      `json:"cost_usd"`
	TurnMS  float64      `json:"turn_ms"`
	WaitMS  float64      `json:"wait_ms"`
	Turns   int          `json:"turns"`
	ByModel []modelSpend `json:"by_model,omitempty"`
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
// five minutes. Cost is the session total (same number Sessions and Home
// show), not the current turn. "doing" is the most recent span; "quiet"
// means nothing new for 90 seconds (the agent is thinking, running
// something long, or waiting).
func liveLanes(db *sql.DB, now int64) ([]liveLane, error) {
	rows, err := db.Query(`SELECT t.trace_id, coalesce(t.session_id,''), t.start_ns, t.end_ns, coalesce(t.span_count,0),
		coalesce(s.cost_usd, t.cost_usd, 0), s.title, coalesce(s.repo,'')
		FROM trace_roots t LEFT JOIN session_stats s ON s.session_id = t.session_id
		WHERE t.in_progress AND t.end_ns > ? ORDER BY t.start_ns`, now-int64(5*time.Minute))
	if err != nil {
		return nil, err
	}
	var lanes []liveLane
	ids := []any{}
	for rows.Next() {
		var l liveLane
		var title sql.NullString
		var repo string
		if err := rows.Scan(&l.TraceID, &l.SessionID, &l.StartNS, &l.LastNS, &l.Spans, &l.CostUSD, &title, &repo); err != nil {
			rows.Close()
			return nil, err
		}
		if title.Valid && title.String != "" {
			t := clipLabel(title.String)
			l.Title = &t
		}
		l.Quiet = now-l.LastNS > int64(90*time.Second)
		lanes = append(lanes, l)
		ids = append(ids, l.TraceID)
	}
	rows.Close()
	if len(ids) == 0 {
		return lanes, rows.Err()
	}
	ph := strings.Repeat("?,", len(ids)-1) + "?"
	dr, err := db.Query(`SELECT trace_id, name, attrs::VARCHAR, coalesce(resource::VARCHAR,'{}') FROM (
		SELECT trace_id, name, attrs, resource, row_number() OVER (PARTITION BY trace_id ORDER BY end_ns DESC) AS rn
		FROM spans WHERE trace_id IN (`+ph+`) AND name IN (`+liveDoingSpanNames+`)
	) x WHERE rn=1`, ids...)
	if err == nil {
		by := map[string]liveLane{}
		for dr.Next() {
			var tid, name, attrs, res string
			if dr.Scan(&tid, &name, &attrs, &res) == nil {
				by[tid] = liveLane{Doing: doing(name, parseObj(attrs)), Source: sourceName(parseObj(res))}
			}
		}
		dr.Close()
		for i := range lanes {
			if d, ok := by[lanes[i].TraceID]; ok {
				lanes[i].Doing = d.Doing
				lanes[i].Source = d.Source
			}
		}
	}
	return lanes, nil
}

// liveDoingSpanNames is the latest-span set for "doing". blocked_on_user
// must stay here so a live approval wait is not dropped for an older LLM span.
const liveDoingSpanNames = "'claude_code.tool','claude_code.llm_request','claude_code.hook','claude_code.tool.blocked_on_user'"

// doing says what a live turn is doing now, in the present tense:
// "Running npm test", "Reading service.go", "Thinking · Opus 5.5".
func doing(name string, a map[string]any) string {
	str := func(k string) string {
		v, _ := a[k].(string)
		return v
	}
	switch name {
	case "claude_code.tool":
		t := str("tool_name")
		file := path.Base(str("file_path"))
		switch {
		case strings.HasPrefix(t, "mcp__"):
			parts := strings.SplitN(t, "__", 3)
			action := strings.ReplaceAll(parts[len(parts)-1], "_", " ")
			server := ""
			if len(parts) > 1 {
				server = strings.ReplaceAll(parts[1], "_", " ")
			}
			return upperFirst(action) + " · " + server
		case t == "Bash":
			if c := str("full_command"); c != "" {
				return "Running " + clipLabel(strings.SplitN(c, "\n", 2)[0])
			}
			return "Running a command"
		case t == "Read" && file != ".":
			return "Reading " + file
		case (t == "Edit" || t == "MultiEdit" || t == "Write") && file != ".":
			return "Editing " + file
		case t == "Grep" || t == "Glob":
			return "Searching the code"
		case t == "Agent" || t == "Task":
			if s := str("subagent_type"); s != "" {
				return "Handing off to " + s
			}
			return "Handing off to a subagent"
		case t == "AskUserQuestion":
			return "Waiting for your answer"
		case t == "WebFetch" || t == "WebSearch":
			return "Reading the web"
		}
		return "Using " + t
	case "claude_code.tool.blocked_on_user":
		return "Waiting for your approval"
	case "claude_code.llm_request":
		return "Thinking · " + modelDisplay(str("model"))
	case "claude_code.hook":
		return "Running hook " + str("hook_name")
	}
	return name
}

// modelDisplay turns claude-opus-5-5 into Opus 5.5.
func modelDisplay(m string) string {
	m = strings.TrimPrefix(m, "claude-")
	if m == "" {
		return "the model"
	}
	parts := strings.Split(m, "-")
	nums := []string{}
	for _, p := range parts[1:] {
		if len(p) >= 8 { // a date suffix
			break
		}
		nums = append(nums, p)
	}
	if len(nums) == 0 {
		return upperFirst(parts[0])
	}
	return upperFirst(parts[0]) + " " + strings.Join(nums, ".")
}

func upperFirst(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
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
	v, err := s.cache.get("overview", s.buildOverview)
	if err != nil {
		s.err(w, err, 500)
		return
	}
	s.json(w, v, 200)
}

func (s *Server) buildOverview() (any, error) {
	db := s.db()
	now := time.Now().UnixNano()
	hi := now
	var latest sql.NullInt64
	_ = db.QueryRow(`SELECT max(end_ns) FROM trace_roots`).Scan(&latest)
	anchored := false
	if latest.Valid && latest.Int64 < now-7*day {
		hi = latest.Int64 + 1
		anchored = true
	}
	lo := hi - 7*day
	cur, err := summarize(db, lo, hi)
	if err != nil {
		return nil, err
	}
	prev, err := summarize(db, lo-7*day, lo)
	if err != nil {
		return nil, err
	}

	end := time.Unix(0, hi).Local()
	start := time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, end.Location()).AddDate(0, 0, -89)
	days := make([]dayPoint, 90)
	byStart := map[int64]int{}
	for i := range days {
		d := start.AddDate(0, 0, i)
		ns := d.UnixNano()
		days[i] = dayPoint{Day: d.Format("Mon 2 Jan"), StartNS: ns}
		byStart[ns] = i
	}
	if dr, err := db.Query(`SELECT day_start_ns, coalesce(turns,0), coalesce(turn_ms,0), coalesce(wait_ms,0), coalesce(cost_usd,0), coalesce(by_model::VARCHAR,'[]')
		FROM day_stats WHERE day_start_ns >= ? AND day_start_ns < ?`, days[0].StartNS, hi); err == nil {
		for dr.Next() {
			var ns int64
			var turns int
			var turnMS, waitMS, cost float64
			var mjs string
			if dr.Scan(&ns, &turns, &turnMS, &waitMS, &cost, &mjs) != nil {
				continue
			}
			i, ok := byStart[ns]
			if !ok {
				continue
			}
			days[i].Turns = turns
			days[i].TurnMS = turnMS
			days[i].WaitMS = waitMS
			days[i].CostUSD = cost
			var models []modelSpend
			_ = json.Unmarshal([]byte(mjs), &models)
			days[i].ByModel = models
		}
		dr.Close()
	}

	lanes, err := liveLanes(db, now)
	if err != nil {
		return nil, err
	}
	if lanes == nil {
		lanes = []liveLane{}
	}
	srcs, err := sources(db, now)
	if err != nil {
		return nil, err
	}

	findings := findingsFor(db)
	historyOnly := history.Only(db)
	open := 0
	for _, f := range findings {
		if f.Severity == "error" {
			continue
		}
		open++
	}
	monthAgo := time.Now().AddDate(0, -1, 0).UnixNano()
	spend, windowDays := observeSpend(db, monthAgo, now)
	savings := rules.HomeSurfaceFrom(findings, rules.HomeOpts{
		SinceNS:       monthAgo,
		HistoryOnly:   historyOnly,
		ObservedSpend: spend,
		WindowDays:    windowDays,
	})
	var top any
	if len(savings.Shown) > 0 {
		top = savings.Shown[0]
	}

	recent, err := sessionRows(db, 6, lo, hi, historyOnly)
	if err != nil {
		return nil, err
	}

	projects := []history.Project{}
	if historyOnly {
		projects = history.ProjectsIn(db, lo, hi)
		if projects == nil {
			projects = []history.Project{}
		}
	}

	var nRoots int
	_ = db.QueryRow(`SELECT count(*) FROM trace_roots`).Scan(&nRoots)
	return map[string]any{
		"now":          now,
		"lo":           lo,
		"hi":           hi,
		"anchored":     anchored,
		"week":         cur,
		"prev":         prev,
		"days":         days,
		"live":         lanes,
		"sources":      srcs,
		"top":          top,
		"open":         open,
		"savings":      savings,
		"recent":       recent,
		"projects":     projects,
		"history_only": historyOnly,
		"has_data":     nRoots > 0 || len(srcs) > 0,
		"generated":    time.Now().UnixNano(),
	}, nil
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
	rows, err := db.Query(`SELECT name, kind, spans, events, metrics, first_ns, last_ns FROM source_stats ORDER BY last_ns DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []source{}
	for rows.Next() {
		var s source
		if err := rows.Scan(&s.Name, &s.Kind, &s.Spans, &s.Events, &s.Metrics, &s.FirstNS, &s.LastNS); err != nil {
			return nil, err
		}
		s.Live = now-s.LastNS < int64(5*time.Minute)
		out = append(out, s)
	}
	return out, rows.Err()
}

// observeSpend is the actual dollars and span of LLM cost in [lo, hi).
// Home savings must not exceed this, scaled with the same window.
func observeSpend(db *sql.DB, lo, hi int64) (spend, days float64) {
	var cost sql.NullFloat64
	var first, last sql.NullInt64
	_ = db.QueryRow(`SELECT sum(cost_usd), min(start_ns), max(start_ns) FROM llm_facts WHERE start_ns >= ? AND start_ns < ?`, lo, hi).Scan(&cost, &first, &last)
	spend = cost.Float64
	if !first.Valid {
		_ = db.QueryRow(`SELECT min(start_ns), max(end_ns) FROM trace_roots WHERE start_ns >= ? AND start_ns < ?`, lo, hi).Scan(&first, &last)
	}
	if first.Valid && last.Valid && last.Int64 >= first.Int64 {
		days = float64(last.Int64-first.Int64) / 1e9 / 86400
		if days < 1 {
			days = 1
		}
	}
	return spend, days
}

func (s *Server) getSources(w http.ResponseWriter, r *http.Request) {
	out, err := sources(s.db(), time.Now().UnixNano())
	if err != nil {
		s.err(w, err, 500)
		return
	}
	s.json(w, map[string]any{"now": time.Now().UnixNano(), "sources": out}, 200)
}
