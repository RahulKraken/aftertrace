package harness

import (
	"database/sql"
	"fmt"
	"math"
)

const costTol = 1e-6

// Facts is counters and rollup sums. For B7, Want comes from the INPUT
// (unique generated/replayed batches), not a recount of the DB under test.
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

// InputOTLP is the unique-key expectation for n makeBatch payloads: 2 spans
// (interaction + llm), 1 api_request event, cost 0.01 each. Replay copies
// must not change these numbers.
func InputOTLP(nBatches int) Facts {
	n := nBatches
	if n < 0 {
		n = 0
	}
	cost := 0.01 * float64(n)
	return Facts{
		Spans: 2 * n, Events: n, MetaSpans: 2 * n, MetaEvents: n,
		SourceSpans: map[string]int{"claude-code": 2 * n},
		LLMFacts:    n, LLMCost: cost,
		TraceRoots: n, TraceCost: cost,
		Sessions: n, SessionCost: cost,
		DayCost: cost, ModelCost: cost,
	}
}

func queryInt(db *sql.DB, q string, args ...any) (int, error) {
	var n sql.NullInt64
	err := db.QueryRow(q, args...).Scan(&n)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if !n.Valid {
		return 0, nil
	}
	return int(n.Int64), nil
}

func queryFloat(db *sql.DB, q string, args ...any) (float64, error) {
	var n sql.NullFloat64
	err := db.QueryRow(q, args...).Scan(&n)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if !n.Valid {
		return 0, nil
	}
	return n.Float64, nil
}

func queryInt2Float(db *sql.DB, q string) (int, float64, error) {
	var n sql.NullInt64
	var f sql.NullFloat64
	err := db.QueryRow(q).Scan(&n, &f)
	if err == sql.ErrNoRows {
		return 0, 0, nil
	}
	if err != nil {
		return 0, 0, err
	}
	ni, ff := 0, 0.0
	if n.Valid {
		ni = int(n.Int64)
	}
	if f.Valid {
		ff = f.Float64
	}
	return ni, ff, nil
}

// Oracle recounts the DB. Do not use this as B7's expected value: a duplicate
// row in the file under test would match itself. Kept for B8 imported-without-rows
// and debug dumps.
func Oracle(db *sql.DB) (Facts, error) {
	return ReadRaw(db)
}

func ReadRaw(db *sql.DB) (Facts, error) {
	var f Facts
	f.SourceSpans = map[string]int{}
	err := db.QueryRow(`SELECT
		(SELECT count(*) FROM spans),
		(SELECT count(*) FROM span_events),
		(SELECT count(*) FROM events),
		(SELECT count(*) FROM metric_points)`).
		Scan(&f.Spans, &f.SpanEvents, &f.Events, &f.Metrics)
	if err != nil {
		return f, err
	}
	if f.MetaSpans, err = queryInt(db, `SELECT CAST(v AS BIGINT) FROM store_meta WHERE k='counts.spans'`); err != nil {
		return f, fmt.Errorf("meta.spans: %w", err)
	}
	if f.MetaEvents, err = queryInt(db, `SELECT CAST(v AS BIGINT) FROM store_meta WHERE k='counts.events'`); err != nil {
		return f, fmt.Errorf("meta.events: %w", err)
	}
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
	if err := rows.Close(); err != nil {
		return f, err
	}
	if f.ImportedWithoutRows, err = queryInt(db, `SELECT count(*) FROM history_files hf WHERE status='imported' AND NOT EXISTS (
		SELECT 1 FROM spans s WHERE s.session_id = hf.session_id)`); err != nil {
		return f, fmt.Errorf("imported_without_rows: %w", err)
	}
	return f, nil
}

func ReadRollups(db *sql.DB) (Facts, error) {
	var f Facts
	f.SourceSpans = map[string]int{}
	var err error
	err = db.QueryRow(`SELECT
		(SELECT count(*) FROM spans),
		(SELECT count(*) FROM span_events),
		(SELECT count(*) FROM events),
		(SELECT count(*) FROM metric_points)`).
		Scan(&f.Spans, &f.SpanEvents, &f.Events, &f.Metrics)
	if err != nil {
		return f, err
	}
	if f.MetaSpans, err = queryInt(db, `SELECT CAST(coalesce(v,'0') AS BIGINT) FROM store_meta WHERE k='counts.spans'`); err != nil {
		return f, fmt.Errorf("meta.spans: %w", err)
	}
	if f.MetaEvents, err = queryInt(db, `SELECT CAST(coalesce(v,'0') AS BIGINT) FROM store_meta WHERE k='counts.events'`); err != nil {
		return f, fmt.Errorf("meta.events: %w", err)
	}
	rows, err := db.Query(`SELECT name, spans FROM source_stats`)
	if err != nil {
		return f, fmt.Errorf("source_stats: %w", err)
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
	if err := rows.Close(); err != nil {
		return f, err
	}
	if f.LLMFacts, f.LLMCost, err = queryInt2Float(db, `SELECT count(*), coalesce(sum(cost_usd),0) FROM llm_facts`); err != nil {
		return f, fmt.Errorf("llm_facts: %w", err)
	}
	if f.TraceRoots, f.TraceCost, err = queryInt2Float(db, `SELECT count(*), coalesce(sum(cost_usd),0) FROM trace_roots`); err != nil {
		return f, fmt.Errorf("trace_roots: %w", err)
	}
	if f.Sessions, f.SessionCost, err = queryInt2Float(db, `SELECT count(*), coalesce(sum(cost_usd),0) FROM session_stats`); err != nil {
		return f, fmt.Errorf("session_stats: %w", err)
	}
	if f.DayCost, err = queryFloat(db, `SELECT coalesce(sum(cost_usd),0) FROM day_stats`); err != nil {
		return f, fmt.Errorf("day_stats: %w", err)
	}
	if f.ModelCost, err = queryFloat(db, `SELECT coalesce(sum(cost_usd),0) FROM model_stats`); err != nil {
		return f, fmt.Errorf("model_stats: %w", err)
	}
	if f.ImportedWithoutRows, err = queryInt(db, `SELECT count(*) FROM history_files hf WHERE status='imported' AND NOT EXISTS (
		SELECT 1 FROM spans s WHERE s.session_id = hf.session_id)`); err != nil {
		return f, fmt.Errorf("imported_without_rows: %w", err)
	}
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
		if math.Abs(g-w) > costTol {
			d = append(d, Diff{Field: field, Got: fmt.Sprintf("%.12g", g), Want: fmt.Sprintf("%.12g", w)})
		}
	}
	add("spans", got.Spans, want.Spans)
	add("events", got.Events, want.Events)
	add("meta.spans", got.MetaSpans, want.MetaSpans)
	add("meta.events", got.MetaEvents, want.MetaEvents)
	add("llm_facts", got.LLMFacts, want.LLMFacts)
	addf("llm_facts.cost", got.LLMCost, want.LLMCost)
	add("trace_roots", got.TraceRoots, want.TraceRoots)
	addf("trace_roots.cost", got.TraceCost, want.TraceCost)
	add("sessions", got.Sessions, want.Sessions)
	addf("session_stats.cost", got.SessionCost, want.SessionCost)
	addf("day_stats.cost", got.DayCost, want.DayCost)
	addf("model_stats.cost", got.ModelCost, want.ModelCost)
	add("imported_without_rows", got.ImportedWithoutRows, want.ImportedWithoutRows)
	for name, n := range want.SourceSpans {
		add("source_stats.spans."+name, got.SourceSpans[name], n)
	}
	return d
}
