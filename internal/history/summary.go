package history

import (
	"database/sql"
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

// Summarize reads imported history from the store for the Connect screen.
func Summarize(db *sql.DB, dir string) Summary {
	s := Summary{Dir: dir, Models: []string{}, Projects: []Project{}, Series: []Day{}}
	if db == nil {
		return s
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
	if db == nil {
		return false
	}
	var n int
	_ = db.QueryRow(`SELECT count(*) FROM spans
		WHERE coalesce(json_extract_string(resource, '$."aftertrace.source"'), '') <> 'history'`).Scan(&n)
	return n > 0
}
