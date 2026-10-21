package rules

import (
	"database/sql"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strconv"
	"strings"
)

//go:embed files/*.sql
var filesFS embed.FS

type Rule struct {
	ID         string
	Title      string
	Pillar     string
	MinVersion string
	SQL        string
}

type Evidence struct {
	TraceID string `json:"trace_id"`
	SpanID  string `json:"span_id"`
	Label   string `json:"label"`
}

type Finding struct {
	ID             int        `json:"id"`
	RuleID         string     `json:"rule_id"`
	RuleTitle      string     `json:"rule_title"`
	Pillar         string     `json:"pillar"`
	Severity       string     `json:"severity"`
	Headline       string     `json:"headline"`
	ImpactValue    float64    `json:"impact_value"`
	ImpactUnit     string     `json:"impact_unit"`
	Detail         string     `json:"detail"`
	Recommendation string     `json:"recommendation"`
	Evidence       []Evidence `json:"evidence"`
	Sessions       []string   `json:"sessions"`
}

func Load() ([]Rule, error) {
	return loadFS(filesFS)
}

func loadFS(fsys fs.FS) ([]Rule, error) {
	ents, err := fs.ReadDir(fsys, "files")
	if err != nil {
		return nil, err
	}
	var out []Rule
	for _, e := range ents {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		b, err := fs.ReadFile(fsys, path.Join("files", e.Name()))
		if err != nil {
			return nil, err
		}
		r, err := parse(string(b))
		if err != nil {
			return nil, fmt.Errorf("%s: %w", e.Name(), err)
		}
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func parse(src string) (Rule, error) {
	var r Rule
	var sqlLines []string
	for _, line := range strings.Split(src, "\n") {
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "-- @") {
			k, v, _ := strings.Cut(strings.TrimPrefix(trim, "-- @"), " ")
			v = strings.TrimSpace(v)
			switch k {
			case "id":
				r.ID = v
			case "title":
				r.Title = v
			case "pillar":
				r.Pillar = v
			case "min_version":
				r.MinVersion = v
			}
			continue
		}
		sqlLines = append(sqlLines, line)
	}
	r.SQL = strings.TrimSpace(strings.Join(sqlLines, "\n"))
	if r.ID == "" || r.SQL == "" {
		return r, fmt.Errorf("rule missing @id or SQL")
	}
	return r, nil
}

func RunAll(db *sql.DB) []Finding {
	rs, err := Load()
	if err != nil {
		return []Finding{{RuleID: "engine", RuleTitle: "rules", Pillar: "config", Severity: "error",
			Headline: "failed to load rules: " + err.Error(), Evidence: []Evidence{}, Sessions: []string{}}}
	}
	var out []Finding
	for _, r := range rs {
		fs, err := run(db, r)
		if err != nil {
			out = append(out, Finding{
				RuleID: r.ID, RuleTitle: r.Title, Pillar: r.Pillar, Severity: "error",
				Headline: "Rule failed: " + err.Error(), Evidence: []Evidence{}, Sessions: []string{},
			})
			continue
		}
		out = append(out, fs...)
	}
	sev := map[string]int{"high": 0, "medium": 1, "low": 2, "error": 3}
	sort.SliceStable(out, func(i, j int) bool {
		si, sj := sev[out[i].Severity], sev[out[j].Severity]
		if si != sj {
			return si < sj
		}
		return out[i].ImpactValue > out[j].ImpactValue
	})
	for i := range out {
		out[i].ID = i
	}
	return out
}

func run(db *sql.DB, r Rule) ([]Finding, error) {
	rows, err := db.Query(r.SQL)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	idx := map[string]int{}
	for i, c := range cols {
		idx[c] = i
	}
	var out []Finding
	for rows.Next() {
		raw := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range raw {
			ptrs[i] = &raw[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		get := func(name string) any {
			i, ok := idx[name]
			if !ok {
				return nil
			}
			return raw[i]
		}
		f := Finding{
			RuleID:         r.ID,
			RuleTitle:      r.Title,
			Pillar:         r.Pillar,
			Severity:       asStr(get("severity")),
			Headline:       asStr(get("headline")),
			ImpactValue:    round4(asFloat(get("impact_value"))),
			ImpactUnit:     asStr(get("impact_unit")),
			Detail:         asStr(get("detail")),
			Recommendation: asStr(get("recommendation")),
			Evidence:       parseEvidence(get("evidence")),
			Sessions:       parseSessions(get("sessions")),
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func parseEvidence(v any) []Evidence {
	b := asJSONBytes(v)
	if len(b) == 0 || string(b) == "null" {
		return []Evidence{}
	}
	var out []Evidence
	if err := json.Unmarshal(b, &out); err != nil {
		return []Evidence{}
	}
	if out == nil {
		return []Evidence{}
	}
	return out
}

func parseSessions(v any) []string {
	b := asJSONBytes(v)
	if len(b) == 0 || string(b) == "null" {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal(b, &out); err != nil {
		return []string{}
	}
	if out == nil {
		return []string{}
	}
	return out
}

func asJSONBytes(v any) []byte {
	switch t := v.(type) {
	case nil:
		return nil
	case string:
		return []byte(t)
	case []byte:
		return t
	case json.RawMessage:
		return t
	default:
		b, _ := json.Marshal(t)
		return b
	}
}

func asStr(v any) string {
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	case []byte:
		return string(t)
	default:
		return fmt.Sprint(t)
	}
}

func asFloat(v any) float64 {
	if v == nil {
		return 0
	}
	switch t := v.(type) {
	case float64:
		return t
	case float32:
		return float64(t)
	case int64:
		return float64(t)
	case int:
		return float64(t)
	case string:
		f, _ := strconv.ParseFloat(t, 64)
		return f
	case []byte:
		f, _ := strconv.ParseFloat(string(t), 64)
		return f
	default:
		f, _ := strconv.ParseFloat(fmt.Sprint(t), 64)
		return f
	}
}

func round4(v float64) float64 {
	return float64(int(v*10000+0.5)) / 10000
}
