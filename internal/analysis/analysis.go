package analysis

import (
	"database/sql"
	"encoding/json"
	"sort"
)

// Paint priority, highest first. permission_wait is time a person decided a
// permission prompt; permission_check is the same span when config, a hook or
// auto mode decided it (no one was waiting on you).
var cats = []string{"permission_wait", "retry", "model", "tool", "hook", "permission_check"}

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
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return withPendingRoot(out), nil
}

// InProgressAttr marks the stand-in root of a turn that is still running.
const InProgressAttr = "aftertrace.in_progress"

// Claude Code ends claude_code.interaction, and exports it, only when the turn
// finishes. Until then every span points at a parent that has not arrived.
// Stand in for it so a running turn has a root, a time axis and a breakdown.
// Children of a tool that is still running also arrive before their parent;
// hang those under the stand-in until the real parent shows up.
func withPendingRoot(spans []Span) []Span {
	if len(spans) == 0 || interaction(spans) != nil {
		return spans
	}
	have := make(map[string]bool, len(spans))
	for _, s := range spans {
		have[s.SpanID] = true
	}
	refs := map[string]int{}
	start, end := spans[0].StartNS, spans[0].EndNS
	for _, s := range spans {
		if s.ParentSpanID != "" && !have[s.ParentSpanID] {
			refs[s.ParentSpanID]++
		}
		start = min(start, s.StartNS)
		end = max(end, s.EndNS)
	}
	missing, best := "", 0
	for id, n := range refs {
		if n > best || (n == best && id < missing) {
			missing, best = id, n
		}
	}
	if missing == "" {
		return spans
	}
	root := Span{
		SpanID:     missing,
		Name:       "claude_code.interaction",
		StartNS:    start,
		EndNS:      end,
		DurationMS: float64(end-start) / 1e6,
		Attrs:      map[string]any{InProgressAttr: true},
	}
	for i := range spans {
		p := spans[i].ParentSpanID
		if p == "" || have[p] {
			continue
		}
		if p != missing {
			spans[i].ParentSpanID = missing
		}
		if v, ok := spans[i].Attrs["session.id"]; ok && root.Attrs["session.id"] == nil {
			root.Attrs["session.id"] = v
		}
	}
	return append([]Span{root}, spans...)
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
	sources := decisionSources(db, traceID)
	var ivs []interval
	for i := range spans {
		s := &spans[i]
		switch s.Name {
		case "claude_code.tool.blocked_on_user":
			src, _ := s.Attrs["source"].(string)
			if src == "" || src == "unknown" {
				src = sources[s.SpanID]
			}
			if HumanDecision(src) {
				ivs = append(ivs, interval{0, s.StartNS, s.EndNS})
			} else {
				ivs = append(ivs, interval{5, s.StartNS, s.EndNS})
			}
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

// HumanDecision reports whether a permission decision source means a person
// answered the prompt. Claude Code uses user_temporary, user_permanent,
// user_abort and user_reject for people; config, hook and classifier sources
// for automatic decisions. An unknown source counts as a person, so a missing
// attribute never hides waiting time.
func HumanDecision(source string) bool {
	if source == "" || source == "unknown" {
		return true
	}
	return len(source) >= 5 && source[:5] == "user_"
}

// decisionSources maps blocked_on_user span ids to the source on their
// tool_decision event. The span itself says "unknown" in some clients.
func decisionSources(db *sql.DB, traceID string) map[string]string {
	out := map[string]string{}
	rows, err := db.Query(`SELECT span_id, json_extract_string(attrs, '$.source') FROM events
		WHERE trace_id=? AND name='tool_decision' AND span_id IS NOT NULL`, traceID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var src sql.NullString
		if rows.Scan(&id, &src) == nil && src.Valid {
			out[id] = src.String
		}
	}
	return out
}
