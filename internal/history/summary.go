package history

import (
	"database/sql"
	"encoding/json"
	"sort"
	"time"
)

// Project is one cwd's last path component, as stored on imported spans.
type Project struct {
	Name     string  `json:"name"`
	Sessions int     `json:"sessions"`
	CostUSD  float64 `json:"cost_usd"`
	Tokens   float64 `json:"tokens"`
}

// Day is one UTC day of imported usage, for the first-run sparkline.
type Day struct {
	Day      string  `json:"day"`
	Sessions int     `json:"sessions"`
	CostUSD  float64 `json:"cost_usd"`
	Tokens   float64 `json:"tokens"`
}

// Summary is what the Connect screen shows: real numbers from the store,
// not a guess. Found is true when at least one history-sourced session exists.
type Summary struct {
	Dir         string    `json:"dir"`
	Found       bool      `json:"found"`
	Sessions    int       `json:"sessions"`
	Turns       int       `json:"turns"`
	Days        int       `json:"days"`
	FirstNS     int64     `json:"first_ns,omitempty"`
	LastNS      int64     `json:"last_ns,omitempty"`
	CostUSD     float64   `json:"cost_usd"`
	Tokens      float64   `json:"tokens"`
	Models      []string  `json:"models"`
	Projects    []Project `json:"projects"`
	Series      []Day     `json:"series"`
	SkippedOTel int       `json:"skipped_otel,omitempty"`
	Files       int       `json:"files"`
}

const histPred = `coalesce(json_extract_string(s.resource, '$."aftertrace.source"'), '') = 'history'`

func metaFlag(db *sql.DB, k string) (bool, bool) {
	if db == nil {
		return false, false
	}
	var v sql.NullString
	if err := db.QueryRow(`SELECT v FROM store_meta WHERE k=?`, k).Scan(&v); err != nil {
		return false, false
	}
	return v.String == "1", true
}

// Summarize reads imported history from the store for the Connect screen.
func Summarize(db *sql.DB, dir string) Summary {
	s := Summary{Dir: dir, Models: []string{}, Projects: []Project{}, Series: []Day{}}
	if db == nil {
		return s
	}
	var n int
	if err := db.QueryRow(`SELECT count(*) FROM session_stats WHERE history`).Scan(&n); err == nil && n > 0 {
		return summarizeStats(db, dir)
	}

	type sess struct {
		id      string
		start   int64
		project string
		cost    float64
		tokens  float64
	}
	rows, err := db.Query(`SELECT session_id, min(start_ns),
		coalesce(any_value(a(attrs, 'vcs.repository.name')), '')
		FROM spans s WHERE name = 'claude_code.interaction' AND ` + histPred + `
		GROUP BY session_id`)
	if err != nil {
		return s
	}
	defer rows.Close()
	byID := map[string]*sess{}
	var first, last int64
	for rows.Next() {
		var x sess
		if err := rows.Scan(&x.id, &x.start, &x.project); err != nil {
			continue
		}
		if x.project == "" {
			x.project = "unknown"
		}
		byID[x.id] = &x
		if first == 0 || x.start < first {
			first = x.start
		}
		if x.start > last {
			last = x.start
		}
	}
	if err := rows.Err(); err != nil {
		return s
	}
	s.Sessions = len(byID)
	s.Found = s.Sessions > 0
	s.FirstNS = first
	s.LastNS = last
	if first > 0 && last >= first {
		s.Days = int((last-first)/int64(24*time.Hour)) + 1
		if s.Days < 1 {
			s.Days = 1
		}
	}

	_ = db.QueryRow(`SELECT count(*) FROM spans s WHERE name = 'claude_code.interaction' AND ` + histPred).Scan(&s.Turns)

	costRows, err := db.Query(`SELECT l.session_id, coalesce(sum(l.cost_usd), 0),
		coalesce(sum(l.input_tokens+l.output_tokens+l.cache_read_tokens+l.cache_creation_tokens), 0),
		list(DISTINCT l.model)
		FROM llm l JOIN spans s ON s.trace_id = l.trace_id AND s.span_id = l.span_id
		WHERE ` + histPred + ` GROUP BY l.session_id`)
	if err == nil {
		defer costRows.Close()
		models := map[string]struct{}{}
		for costRows.Next() {
			var sid string
			var cost, tokens float64
			var modelsRaw any
			if err := costRows.Scan(&sid, &cost, &tokens, &modelsRaw); err != nil {
				continue
			}
			s.CostUSD += cost
			s.Tokens += tokens
			if x, ok := byID[sid]; ok {
				x.cost = cost
				x.tokens = tokens
			}
			for _, m := range asStrings(modelsRaw) {
				if m != "" {
					models[m] = struct{}{}
				}
			}
		}
		for m := range models {
			s.Models = append(s.Models, m)
		}
		sort.Strings(s.Models)
	}

	proj := map[string]*Project{}
	dayMap := map[string]*Day{}
	for _, x := range byID {
		p := proj[x.project]
		if p == nil {
			p = &Project{Name: x.project}
			proj[x.project] = p
		}
		p.Sessions++
		p.CostUSD += x.cost
		p.Tokens += x.tokens
		day := time.Unix(0, x.start).UTC().Format("2006-01-02")
		d := dayMap[day]
		if d == nil {
			d = &Day{Day: day}
			dayMap[day] = d
		}
		d.Sessions++
		d.CostUSD += x.cost
		d.Tokens += x.tokens
	}
	for _, p := range proj {
		s.Projects = append(s.Projects, *p)
	}
	sort.Slice(s.Projects, func(i, j int) bool {
		if s.Projects[i].Sessions != s.Projects[j].Sessions {
			return s.Projects[i].Sessions > s.Projects[j].Sessions
		}
		return s.Projects[i].Name < s.Projects[j].Name
	})
	if len(s.Projects) > 8 {
		s.Projects = s.Projects[:8]
	}
	for _, d := range dayMap {
		s.Series = append(s.Series, *d)
	}
	sort.Slice(s.Series, func(i, j int) bool { return s.Series[i].Day < s.Series[j].Day })

	_ = db.QueryRow(`SELECT count(*) FROM history_files WHERE status = 'skipped_otel'`).Scan(&s.SkippedOTel)
	_ = db.QueryRow(`SELECT count(*) FROM history_files`).Scan(&s.Files)
	return s
}

func summarizeStats(db *sql.DB, dir string) Summary {
	s := Summary{Dir: dir, Models: []string{}, Projects: []Project{}, Series: []Day{}}
	rows, err := db.Query(`SELECT session_id, start_ns, coalesce(cost_usd,0), coalesce(tokens,0), coalesce(turns,0), coalesce(repo,''), coalesce(models::VARCHAR,'[]')
		FROM session_stats WHERE history`)
	if err != nil {
		return s
	}
	defer rows.Close()
	proj := map[string]*Project{}
	dayMap := map[string]*Day{}
	models := map[string]struct{}{}
	var first, last int64
	for rows.Next() {
		var sid, repo, mjs string
		var start int64
		var cost, tokens float64
		var turns int
		if err := rows.Scan(&sid, &start, &cost, &tokens, &turns, &repo, &mjs); err != nil {
			continue
		}
		s.Sessions++
		s.Turns += turns
		s.CostUSD += cost
		s.Tokens += tokens
		if first == 0 || start < first {
			first = start
		}
		if start > last {
			last = start
		}
		if repo == "" {
			repo = "unknown"
		}
		p := proj[repo]
		if p == nil {
			p = &Project{Name: repo}
			proj[repo] = p
		}
		p.Sessions++
		p.CostUSD += cost
		p.Tokens += tokens
		day := time.Unix(0, start).UTC().Format("2006-01-02")
		d := dayMap[day]
		if d == nil {
			d = &Day{Day: day}
			dayMap[day] = d
		}
		d.Sessions++
		d.CostUSD += cost
		d.Tokens += tokens
		for _, m := range asStringsJSON(mjs) {
			if m != "" {
				models[m] = struct{}{}
			}
		}
		_ = sid
	}
	s.Found = s.Sessions > 0
	s.FirstNS, s.LastNS = first, last
	if first > 0 && last >= first {
		s.Days = int((last-first)/int64(24*time.Hour)) + 1
		if s.Days < 1 {
			s.Days = 1
		}
	}
	for m := range models {
		s.Models = append(s.Models, m)
	}
	sort.Strings(s.Models)
	for _, p := range proj {
		s.Projects = append(s.Projects, *p)
	}
	sort.Slice(s.Projects, func(i, j int) bool {
		if s.Projects[i].Sessions != s.Projects[j].Sessions {
			return s.Projects[i].Sessions > s.Projects[j].Sessions
		}
		return s.Projects[i].Name < s.Projects[j].Name
	})
	if len(s.Projects) > 8 {
		s.Projects = s.Projects[:8]
	}
	for _, d := range dayMap {
		s.Series = append(s.Series, *d)
	}
	sort.Slice(s.Series, func(i, j int) bool { return s.Series[i].Day < s.Series[j].Day })
	_ = db.QueryRow(`SELECT count(*) FROM history_files WHERE status = 'skipped_otel'`).Scan(&s.SkippedOTel)
	_ = db.QueryRow(`SELECT count(*) FROM history_files`).Scan(&s.Files)
	return s
}

func asStringsJSON(s string) []string {
	var arr []string
	if json.Unmarshal([]byte(s), &arr) == nil {
		return arr
	}
	return asStrings(s)
}

// ProjectsIn is cost by project over [lo, hi), the same llm window Home uses
// for the week headline. The rows sum to that week's cost_usd.
func ProjectsIn(db *sql.DB, lo, hi int64) []Project {
	if db == nil {
		return []Project{}
	}
	rows, err := db.Query(`SELECT coalesce(nullif(repo, ''), 'unknown'),
		count(DISTINCT session_id),
		coalesce(sum(cost_usd), 0),
		coalesce(sum(tokens), 0)
		FROM trace_roots WHERE start_ns >= ? AND start_ns < ?
		GROUP BY 1 ORDER BY 3 DESC, 1`, lo, hi)
	if err != nil {
		return []Project{}
	}
	defer rows.Close()
	out := []Project{}
	for rows.Next() {
		var p Project
		if err := rows.Scan(&p.Name, &p.Sessions, &p.CostUSD, &p.Tokens); err != nil {
			continue
		}
		out = append(out, p)
	}
	return out
}

func asStrings(v any) []string {
	switch t := v.(type) {
	case []string:
		return t
	case []any:
		out := make([]string, 0, len(t))
		for _, x := range t {
			if s, ok := x.(string); ok && s != "" {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

// LiveOTel is true when the store has any span that did not come from history.
func LiveOTel(db *sql.DB) bool {
	if v, ok := metaFlag(db, "live_otel"); ok {
		return v
	}
	if db == nil {
		return false
	}
	var n int
	_ = db.QueryRow(`SELECT count(*) FROM source_stats`).Scan(&n)
	if n > 0 {
		var histOnly int
		_ = db.QueryRow(`SELECT count(*) FROM session_stats WHERE NOT history`).Scan(&histOnly)
		return histOnly > 0
	}
	_ = db.QueryRow(`SELECT count(*) FROM spans
		WHERE coalesce(json_extract_string(resource, '$."aftertrace.source"'), '') <> 'history'`).Scan(&n)
	return n > 0
}

// HasHistory is true when any span was imported from session files.
func HasHistory(db *sql.DB) bool {
	if v, ok := metaFlag(db, "has_history"); ok {
		return v
	}
	if db == nil {
		return false
	}
	var n int
	_ = db.QueryRow(`SELECT count(*) FROM session_stats WHERE history`).Scan(&n)
	if n > 0 {
		return true
	}
	_ = db.QueryRow(`SELECT count(*) FROM spans
		WHERE coalesce(json_extract_string(resource, '$."aftertrace.source"'), '') = 'history'`).Scan(&n)
	return n > 0
}

// Only is true when the store has imported history and no live OTel spans.
func Only(db *sql.DB) bool {
	return HasHistory(db) && !LiveOTel(db)
}
