package analysis

import (
	"database/sql"
	"encoding/json"
	"sort"
)

var cats = []string{"permission_wait", "retry", "model", "tool", "hook"}

type Span struct {
	SpanID        string         `json:"span_id"`
	ParentSpanID  string         `json:"parent_span_id"`
	Name          string         `json:"name"`
	StartNS       int64          `json:"start_ns"`
	EndNS         int64          `json:"end_ns"`
	DurationMS    float64        `json:"duration_ms"`
	IsError       bool           `json:"is_error"`
	StatusMessage string         `json:"status_message"`
	Attrs         map[string]any `json:"attrs"`
	Critical      bool           `json:"critical,omitempty"`
	Joined        map[string]any `json:"joined,omitempty"`
	RetryEndNS    *int64         `json:"retry_end_ns,omitempty"`
	Findings      []int          `json:"findings,omitempty"`
}

type interval struct {
	cat   int
	start int64
	end   int64
}

func SpanRows(db *sql.DB, traceID string) ([]Span, error) {
	rows, err := db.Query(`SELECT span_id, coalesce(parent_span_id,''), name, start_ns, end_ns, duration_ms, is_error, coalesce(status_message,''), attrs::VARCHAR
		FROM spans WHERE trace_id=? ORDER BY start_ns, end_ns DESC`, traceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Span
	for rows.Next() {
		var s Span
		var attrs string
		if err := rows.Scan(&s.SpanID, &s.ParentSpanID, &s.Name, &s.StartNS, &s.EndNS, &s.DurationMS, &s.IsError, &s.StatusMessage, &attrs); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(attrs), &s.Attrs)
		if s.Attrs == nil {
			s.Attrs = map[string]any{}
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func RetryEnd(db *sql.DB, traceID, spanID string) *int64 {
	var t sql.NullInt64
	var n int
	err := db.QueryRow(`SELECT max(time_ns), count(*) FROM span_events WHERE trace_id=? AND span_id=? AND name='gen_ai.request.attempt'`,
		traceID, spanID).Scan(&t, &n)
	if err != nil || n <= 1 || !t.Valid {
		return nil
	}
	v := t.Int64
	return &v
}

func Breakdown(db *sql.DB, traceID string, spans []Span) map[string]float64 {
	root := interaction(spans)
	if root == nil {
		return nil
	}
	var ivs []interval
	for i := range spans {
		s := &spans[i]
		switch s.Name {
		case "claude_code.tool.blocked_on_user":
			ivs = append(ivs, interval{0, s.StartNS, s.EndNS})
		case "claude_code.tool.execution":
			ivs = append(ivs, interval{3, s.StartNS, s.EndNS})
		case "claude_code.hook":
			ivs = append(ivs, interval{4, s.StartNS, s.EndNS})
		case "claude_code.llm_request":
			re := RetryEnd(db, traceID, s.SpanID)
			if s.IsError {
				ivs = append(ivs, interval{1, s.StartNS, s.EndNS})
			} else if re != nil {
				ivs = append(ivs, interval{1, s.StartNS, *re}, interval{2, *re, s.EndNS})
			} else {
				ivs = append(ivs, interval{2, s.StartNS, s.EndNS})
			}
		}
	}
	rows, err := db.Query(`SELECT ts_ns, n(attrs,'total_duration_ms') FROM events WHERE trace_id=? AND name='hook_execution_complete'`, traceID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var ts int64
			var d sql.NullFloat64
			if err := rows.Scan(&ts, &d); err != nil || !d.Valid {
				continue
			}
			ivs = append(ivs, interval{4, ts - int64(d.Float64*1e6), ts})
		}
	}
	return paint(ivs, root.StartNS, root.EndNS)
}

func paint(ivs []interval, start, end int64) map[string]float64 {
	pts := map[int64]struct{}{start: {}, end: {}}
	for _, iv := range ivs {
		if iv.start >= start && iv.start <= end {
			pts[iv.start] = struct{}{}
		}
		if iv.end >= start && iv.end <= end {
			pts[iv.end] = struct{}{}
		}
	}
	keys := make([]int64, 0, len(pts))
	for p := range pts {
		keys = append(keys, p)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })
	out := map[string]float64{"other": 0}
	for _, c := range cats {
		out[c] = 0
	}
	for i := 0; i+1 < len(keys); i++ {
		a, b := keys[i], keys[i+1]
		mid := (a + b) / 2
		active := -1
		for _, iv := range ivs {
			if iv.start <= mid && mid < iv.end && (active < 0 || iv.cat < active) {
				active = iv.cat
			}
		}
		ms := float64(b-a) / 1e6
		if active < 0 {
			out["other"] += ms
		} else {
			out[cats[active]] += ms
		}
	}
	return out
}

func CriticalPath(spans []Span) map[string]struct{} {
	kids := map[string][]*Span{}
	for i := range spans {
		s := &spans[i]
		kids[s.ParentSpanID] = append(kids[s.ParentSpanID], s)
	}
	root := interaction(spans)
	path := map[string]struct{}{}
	var walk func(s *Span)
	walk = func(s *Span) {
		path[s.SpanID] = struct{}{}
		cursor := s.EndNS
		ch := append([]*Span(nil), kids[s.SpanID]...)
		sort.Slice(ch, func(i, j int) bool {
			if ch[i].EndNS != ch[j].EndNS {
				return ch[i].EndNS > ch[j].EndNS
			}
			ei := ch[i].Name == "claude_code.tool.execution"
			ej := ch[j].Name == "claude_code.tool.execution"
			return !ei && ej
		})
		for _, c := range ch {
			if c.EndNS <= cursor+1_000_000 && c.StartNS < cursor {
				walk(c)
				cursor = c.StartNS
			}
		}
	}
	if root != nil {
		walk(root)
	}
	return path
}

func interaction(spans []Span) *Span {
	for i := range spans {
		if spans[i].Name == "claude_code.interaction" {
			return &spans[i]
		}
	}
	return nil
}
