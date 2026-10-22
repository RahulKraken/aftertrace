package api

import (
	"database/sql"
	"net/http"
	"time"
)

// Apps are services other than Claude Code that sent spans. Model-call numbers
// come from the calls view; services with no model calls still appear, with
// their span counts, so a newly connected app shows up straight away.

type appRow struct {
	Service   string    `json:"service"`
	Spans     int64     `json:"spans"`
	Traces    int64     `json:"traces"`
	Calls     int64     `json:"calls"`
	Failed    int64     `json:"failed"`
	CostUSD   float64   `json:"cost_usd"`
	InputTok  float64   `json:"input_tokens"`
	OutputTok float64   `json:"output_tokens"`
	CacheRead float64   `json:"cache_read_tokens"`
	P50MS     *float64  `json:"p50_ms"`
	P95MS     *float64  `json:"p95_ms"`
	TTFTP50   *float64  `json:"ttft_p50_ms"`
	Models    []string  `json:"models"`
	Ops       int64     `json:"operations"`
	FirstNS   int64     `json:"first_ns"`
	LastNS    int64     `json:"last_ns"`
	Live      bool      `json:"live"`
	DailyCost []float64 `json:"daily_cost"`
	Daily     []int64   `json:"daily_calls"`
}

func nullF(v sql.NullFloat64) *float64 {
	if !v.Valid {
		return nil
	}
	f := v.Float64
	return &f
}

func appRows(db *sql.DB, only string) ([]appRow, error) {
	now := time.Now().UnixNano()
	q := `
		WITH svc AS (
			SELECT coalesce(json_extract_string(resource, '$."service.name"'), 'unknown') AS service,
				count(*) AS spans, count(DISTINCT trace_id) AS traces, min(start_ns) AS first_ns, max(end_ns) AS last_ns
			FROM spans GROUP BY 1
		), c AS (
			SELECT service, count(*) AS calls, count(*) FILTER (WHERE is_error OR error_type IS NOT NULL) AS failed,
				sum(cost_usd) AS cost, sum(input_tokens) AS tin, sum(output_tokens) AS tout, sum(cache_read_tokens) AS tread,
				quantile_cont(duration_ms, 0.5) AS p50, quantile_cont(duration_ms, 0.95) AS p95, quantile_cont(ttft_ms, 0.5) AS ttft,
				list(DISTINCT model) FILTER (WHERE model IS NOT NULL) AS models, count(DISTINCT operation) AS ops
			FROM calls GROUP BY 1
		)
		SELECT svc.service, svc.spans, svc.traces, coalesce(c.calls, 0), coalesce(c.failed, 0), coalesce(c.cost, 0),
			coalesce(c.tin, 0), coalesce(c.tout, 0), coalesce(c.tread, 0), c.p50, c.p95, c.ttft, c.models, coalesce(c.ops, 0),
			svc.first_ns, svc.last_ns
		FROM svc LEFT JOIN c USING (service)
		WHERE svc.service NOT LIKE 'claude-code%' AND (? = '' OR svc.service = ?)
		ORDER BY svc.last_ns DESC`
	rows, err := db.Query(q, only, only)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []appRow{}
	for rows.Next() {
		var a appRow
		var p50, p95, ttft sql.NullFloat64
		var models any
		if err := rows.Scan(&a.Service, &a.Spans, &a.Traces, &a.Calls, &a.Failed, &a.CostUSD, &a.InputTok, &a.OutputTok, &a.CacheRead,
			&p50, &p95, &ttft, &models, &a.Ops, &a.FirstNS, &a.LastNS); err != nil {
			return nil, err
		}
		a.P50MS, a.P95MS, a.TTFTP50 = nullF(p50), nullF(p95), nullF(ttft)
		a.Models = asStringSlice(models)
		a.Live = now-a.LastNS < int64(5*time.Minute)
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// 14 daily buckets ending at the newest data, for sparklines.
	for i := range out {
		a := &out[i]
		end := time.Unix(0, max(a.LastNS, 1)).Local()
		start := time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, end.Location()).AddDate(0, 0, -13)
		a.DailyCost = make([]float64, 14)
		a.Daily = make([]int64, 14)
		dr, err := db.Query(`SELECT start_ns, coalesce(cost_usd, 0) FROM calls WHERE service=? AND start_ns >= ?`, a.Service, start.UnixNano())
		if err != nil {
			return nil, err
		}
		for dr.Next() {
			var st int64
			var c float64
			if dr.Scan(&st, &c) == nil {
				d := int(time.Unix(0, st).Local().Sub(start).Hours() / 24)
				if d >= 0 && d < 14 {
					a.DailyCost[d] += c
					a.Daily[d]++
				}
			}
		}
		dr.Close()
	}
	return out, nil
}

func (s *Server) getApps(w http.ResponseWriter, r *http.Request) {
	out, err := appRows(s.db(), "")
	if err != nil {
		s.err(w, err, 500)
		return
	}
	s.json(w, out, 200)
}

func (s *Server) getApp(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("service")
	db := s.db()
	apps, err := appRows(db, name)
	if err != nil {
		s.err(w, err, 500)
		return
	}
	if len(apps) == 0 {
		s.err(w, errNotFound(name), 404)
		return
	}
	ops, err := groupCalls(db, name, "operation")
	if err != nil {
		s.err(w, err, 500)
		return
	}
	models, err := groupCalls(db, name, "model")
	if err != nil {
		s.err(w, err, 500)
		return
	}
	recent, err := recentTraces(db, name)
	if err != nil {
		s.err(w, err, 500)
		return
	}
	errs, err := recentErrors(db, name)
	if err != nil {
		s.err(w, err, 500)
		return
	}
	s.json(w, map[string]any{"app": apps[0], "operations": ops, "models": models, "recent": recent, "errors": errs}, 200)
}

type notFound string

func (e notFound) Error() string { return "no app named " + string(e) }
func errNotFound(n string) error { return notFound(n) }

// groupCalls aggregates an app's calls by operation or model. dim is one of
// two fixed column names, never user input.
func groupCalls(db *sql.DB, service, dim string) ([]map[string]any, error) {
	col := "operation"
	if dim == "model" {
		col = "coalesce(model, 'unknown')"
	}
	rows, err := db.Query(`SELECT `+col+` AS k, count(*), count(*) FILTER (WHERE is_error OR error_type IS NOT NULL), sum(cost_usd),
		quantile_cont(duration_ms, 0.5), quantile_cont(duration_ms, 0.95), quantile_cont(ttft_ms, 0.5),
		avg(input_tokens), avg(output_tokens), list(DISTINCT model) FILTER (WHERE model IS NOT NULL), bool_and(cost_reported)
		FROM calls WHERE service=? GROUP BY 1 ORDER BY sum(cost_usd) DESC NULLS LAST, count(*) DESC`, service)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var k string
		var n, failed int64
		var cost, p50, p95, ttft, ain, aout sql.NullFloat64
		var models any
		var reported sql.NullBool
		if err := rows.Scan(&k, &n, &failed, &cost, &p50, &p95, &ttft, &ain, &aout, &models, &reported); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"key": k, "calls": n, "failed": failed, "cost_usd": nullNum(cost), "p50_ms": nullNum(p50), "p95_ms": nullNum(p95),
			"ttft_p50_ms": nullNum(ttft), "avg_input_tokens": nullNum(ain), "avg_output_tokens": nullNum(aout),
			"models": asStringSlice(models), "cost_estimated": reported.Valid && !reported.Bool,
		})
	}
	return out, rows.Err()
}

// recentTraces lists an app's newest traces with their calls rolled up.
func recentTraces(db *sql.DB, service string) ([]map[string]any, error) {
	rows, err := db.Query(`
		WITH t AS (
			SELECT trace_id, min(start_ns) AS st, max(end_ns) AS en, bool_or(is_error) AS err,
				arg_min(name, CASE WHEN coalesce(parent_span_id, '') = '' THEN 0 ELSE 1 END) AS root
			FROM spans WHERE json_extract_string(resource, '$."service.name"') = ?
			GROUP BY 1 ORDER BY st DESC LIMIT 40
		)
		SELECT t.trace_id, t.root, t.st, (t.en - t.st) / 1e6, t.err,
			(SELECT count(*) FROM calls c WHERE c.trace_id = t.trace_id),
			(SELECT sum(cost_usd) FROM calls c WHERE c.trace_id = t.trace_id),
			(SELECT sum(input_tokens) + sum(output_tokens) FROM calls c WHERE c.trace_id = t.trace_id),
			(SELECT string_agg(DISTINCT model, ', ') FROM calls c WHERE c.trace_id = t.trace_id)
		FROM t ORDER BY t.st DESC`, service)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, root string
		var st int64
		var d float64
		var failed bool
		var calls int64
		var cost, tokens sql.NullFloat64
		var models sql.NullString
		if err := rows.Scan(&id, &root, &st, &d, &failed, &calls, &cost, &tokens, &models); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"trace_id": id, "name": root, "start_ns": st, "duration_ms": d, "error": failed,
			"calls": calls, "cost_usd": nullNum(cost), "tokens": nullNum(tokens), "models": nullStr(models),
		})
	}
	return out, rows.Err()
}

func recentErrors(db *sql.DB, service string) ([]map[string]any, error) {
	rows, err := db.Query(`SELECT trace_id, span_id, name, start_ns, coalesce(status_message, ''),
			coalesce(a(attrs, 'error.type'), '')
		FROM spans WHERE json_extract_string(resource, '$."service.name"') = ? AND is_error
		ORDER BY start_ns DESC LIMIT 10`, service)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var tid, sid, name, msg, typ string
		var st int64
		if err := rows.Scan(&tid, &sid, &name, &st, &msg, &typ); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"trace_id": tid, "span_id": sid, "name": name, "start_ns": st, "message": msg, "error_type": typ})
	}
	return out, rows.Err()
}
