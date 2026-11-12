package harness

import (
	"database/sql"
	"fmt"
	"math"
)

// Facts is a from-scratch recount of counters and rollup sums from raw tables.
type Facts struct {
	Spans, SpanEvents, Events, Metrics int
	MetaSpans, MetaEvents              int
	SourceSpans                        map[string]int
	LLMFacts                           int
	LLMCost                            float64
	TraceRoots                         int
	TraceCost                          float64
	Sessions                           int
	SessionCost                        float64
	DayCost                            float64
	ModelCost                          float64
	ImportedWithoutRows                int
}

type Diff struct {
	Field string
	Got   string
	Want  string
}

// Oracle recomputes counters from the raw tables in Go. Duplicate api_request
// rows for one request_id count once. Cost matches within 1e-9 of a clean recount.
func Oracle(db *sql.DB) (Facts, error) {
	var f Facts
	f.SourceSpans = map[string]int{}
	if err := db.QueryRow(`SELECT
		(SELECT count(*) FROM spans),
		(SELECT count(*) FROM span_events),
		(SELECT count(*) FROM events),
		(SELECT count(*) FROM metric_points)`).
		Scan(&f.Spans, &f.SpanEvents, &f.Events, &f.Metrics); err != nil {
		return f, err
	}
	_ = db.QueryRow(`SELECT CAST(v AS BIGINT) FROM store_meta WHERE k='counts.spans'`).Scan(&f.MetaSpans)
	_ = db.QueryRow(`SELECT CAST(v AS BIGINT) FROM store_meta WHERE k='counts.events'`).Scan(&f.MetaEvents)

	rows, err := db.Query(`SELECT coalesce(json_extract_string(resource, '$."service.name"'), 'unknown'), count(*) FROM spans GROUP BY 1`)
	if err != nil {
		return f, err
	}
	for rows.Next() {
		var name string
		var n int
		if err := rows.Scan(&name, &n); err != nil {
			rows.Close()
			return f, err
		}
		f.SourceSpans[name] = n
	}
	rows.Close()

	costByReq := map[string]float64{}
	erows, err := db.Query(`SELECT coalesce(request_id,''), coalesce(json_extract(attrs, '$.cost_usd'), 0) FROM events WHERE name='api_request'`)
	if err != nil {
		return f, err
	}
	for erows.Next() {
		var rid string
		var cost float64
		if err := erows.Scan(&rid, &cost); err != nil {
			erows.Close()
			return f, err
		}
		if rid == "" {
			continue
		}
		if _, seen := costByReq[rid]; !seen {
			costByReq[rid] = cost
		}
	}
	erows.Close()

	srows, err := db.Query(`SELECT coalesce(json_extract_string(attrs, '$.request_id'), '') FROM spans WHERE name='claude_code.llm_request'`)
	if err != nil {
		return f, err
	}
	for srows.Next() {
		var rid string
		if err := srows.Scan(&rid); err != nil {
			srows.Close()
			return f, err
		}
		f.LLMFacts++
		f.LLMCost += costByReq[rid]
	}
	srows.Close()

	_ = db.QueryRow(`SELECT count(*) FROM spans WHERE name='claude_code.interaction'`).Scan(&f.TraceRoots)
	_ = db.QueryRow(`SELECT count(*) FROM history_files hf WHERE status='imported' AND NOT EXISTS (
		SELECT 1 FROM spans s WHERE s.session_id = hf.session_id)`).Scan(&f.ImportedWithoutRows)
	return f, nil
}

func ReadRollups(db *sql.DB) (Facts, error) {
	var f Facts
	f.SourceSpans = map[string]int{}
	_ = db.QueryRow(`SELECT
		(SELECT count(*) FROM spans),
		(SELECT count(*) FROM span_events),
		(SELECT count(*) FROM events),
		(SELECT count(*) FROM metric_points)`).
		Scan(&f.Spans, &f.SpanEvents, &f.Events, &f.Metrics)
	_ = db.QueryRow(`SELECT CAST(coalesce(v,'0') AS BIGINT) FROM store_meta WHERE k='counts.spans'`).Scan(&f.MetaSpans)
	_ = db.QueryRow(`SELECT CAST(coalesce(v,'0') AS BIGINT) FROM store_meta WHERE k='counts.events'`).Scan(&f.MetaEvents)
	rows, err := db.Query(`SELECT name, spans FROM source_stats`)
	if err == nil {
		for rows.Next() {
			var name string
			var n int
			if rows.Scan(&name, &n) == nil {
				f.SourceSpans[name] = n
			}
		}
		rows.Close()
	}
	_ = db.QueryRow(`SELECT count(*), coalesce(sum(cost_usd),0) FROM llm_facts`).Scan(&f.LLMFacts, &f.LLMCost)
	_ = db.QueryRow(`SELECT count(*), coalesce(sum(cost_usd),0) FROM trace_roots`).Scan(&f.TraceRoots, &f.TraceCost)
	_ = db.QueryRow(`SELECT count(*), coalesce(sum(cost_usd),0) FROM session_stats`).Scan(&f.Sessions, &f.SessionCost)
	_ = db.QueryRow(`SELECT coalesce(sum(cost_usd),0) FROM day_stats`).Scan(&f.DayCost)
	_ = db.QueryRow(`SELECT coalesce(sum(cost_usd),0) FROM model_stats`).Scan(&f.ModelCost)
	_ = db.QueryRow(`SELECT count(*) FROM history_files hf WHERE status='imported' AND NOT EXISTS (
		SELECT 1 FROM spans s WHERE s.session_id = hf.session_id)`).Scan(&f.ImportedWithoutRows)
	return f, nil
}

func CompareFacts(got, want Facts) []Diff {
	var d []Diff
	add := func(field string, g, w any) {
		if fmt.Sprint(g) != fmt.Sprint(w) {
			d = append(d, Diff{Field: field, Got: fmt.Sprint(g), Want: fmt.Sprint(w)})
		}
	}
	addf := func(field string, g, w float64) {
		if math.Abs(g-w) > 1e-9 {
			d = append(d, Diff{Field: field, Got: fmt.Sprintf("%.12g", g), Want: fmt.Sprintf("%.12g", w)})
		}
	}
	add("spans", got.Spans, want.Spans)
	add("events", got.Events, want.Events)
	add("meta.spans", got.MetaSpans, want.Spans)
	add("meta.events", got.MetaEvents, want.Events)
	add("llm_facts", got.LLMFacts, want.LLMFacts)
	addf("llm_facts.cost", got.LLMCost, want.LLMCost)
	add("trace_roots", got.TraceRoots, want.TraceRoots)
	add("imported_without_rows", got.ImportedWithoutRows, 0)
	for name, n := range want.SourceSpans {
		add("source_stats.spans."+name, got.SourceSpans[name], n)
	}
	return d
}
