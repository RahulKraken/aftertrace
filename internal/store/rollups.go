package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/RahulKraken/aftertrace/internal/analysis"
)

const (
	metaSpans      = "counts.spans"
	metaSpanEvents = "counts.span_events"
	metaEvents     = "counts.events"
	metaMetrics    = "counts.metrics"
	metaHistory    = "has_history"
	metaLiveOTel   = "live_otel"
)

func (s *Store) refreshAfterInsert(spans []Span, sevs []SpanEvent, evs []Event, pts []MetricPoint) error {
	traces := map[string]struct{}{}
	sessions := map[string]struct{}{}
	for _, sp := range spans {
		if sp.TraceID != "" {
			traces[sp.TraceID] = struct{}{}
		}
		if sp.SessionID != "" {
			sessions[sp.SessionID] = struct{}{}
		}
	}
	for _, e := range evs {
		if e.TraceID != "" {
			traces[e.TraceID] = struct{}{}
		}
		if e.SessionID != "" {
			sessions[e.SessionID] = struct{}{}
		}
	}
	for _, p := range pts {
		if p.SessionID != "" {
			sessions[p.SessionID] = struct{}{}
		}
	}
	if err := s.upsertLLMFacts(spans, evs); err != nil {
		return err
	}
	if err := s.bumpSources(spans, evs, pts); err != nil {
		return err
	}
	if err := s.bumpCounts(len(spans), len(sevs), len(evs), len(pts)); err != nil {
		return err
	}
	s.noteOrigin(spans, evs, pts)
	tids := keys(traces)
	sids := keys(sessions)
	if err := s.refreshTraces(tids); err != nil {
		return err
	}
	if len(tids) > 0 {
		rows, err := s.DB.Query(`SELECT DISTINCT session_id FROM trace_roots WHERE trace_id IN (`+placeholders(len(tids))+`) AND session_id IS NOT NULL`, anyStrings(tids)...)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id string
			if rows.Scan(&id) == nil && id != "" {
				sessions[id] = struct{}{}
			}
		}
		rows.Close()
		sids = keys(sessions)
	}
	if err := s.refreshSessions(sids); err != nil {
		return err
	}
	if err := s.refreshDaysForTraces(tids); err != nil {
		return err
	}
	return s.refreshModels()
}

func (s *Store) upsertLLMFacts(spans []Span, evs []Event) error {
	costByReq := map[string]float64{}
	for _, e := range evs {
		if e.Name != "api_request" {
			continue
		}
		rid := e.RequestID
		if rid == "" {
			rid = strAttr(e.Attrs, "request_id")
		}
		if rid == "" {
			continue
		}
		if c, ok := numAttr(e.Attrs, "cost_usd"); ok {
			costByReq[rid] = c
		}
	}
	n := 0
	for _, sp := range spans {
		if sp.Name == "claude_code.llm_request" {
			n++
		}
	}
	if n == 0 && len(costByReq) == 0 {
		return nil
	}
	if n > 0 {
		stmt, err := s.DB.Prepare(`INSERT OR REPLACE INTO llm_facts
			(trace_id, span_id, session_id, start_ns, model, request_id, cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, is_error, attempt)
			VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
		if err != nil {
			return err
		}
		defer stmt.Close()
		for _, sp := range spans {
			if sp.Name != "claude_code.llm_request" {
				continue
			}
			rid := strAttr(sp.Attrs, "request_id")
			cost, _ := numAttr(sp.Attrs, "cost_usd")
			if c, ok := costByReq[rid]; ok {
				cost = c
			}
			in, _ := numAttr(sp.Attrs, "input_tokens")
			out, _ := numAttr(sp.Attrs, "output_tokens")
			cr, _ := numAttr(sp.Attrs, "cache_read_tokens")
			cw, _ := numAttr(sp.Attrs, "cache_creation_tokens")
			att, _ := numAttr(sp.Attrs, "attempt")
			if _, err := stmt.Exec(sp.TraceID, sp.SpanID, nullEmpty(sp.SessionID), sp.StartNS,
				nullEmpty(strAttr(sp.Attrs, "model")), nullEmpty(rid), nullZero(cost),
				nullZero(in), nullZero(out), nullZero(cr), nullZero(cw), sp.IsError, nullZero(att)); err != nil {
				return fmt.Errorf("llm_facts %s/%s: %w", sp.TraceID, sp.SpanID, err)
			}
		}
	}
	if len(costByReq) == 0 {
		return nil
	}
	up, err := s.DB.Prepare(`UPDATE llm_facts SET cost_usd=? WHERE request_id=? AND (cost_usd IS NULL OR cost_usd=0)`)
	if err != nil {
		return err
	}
	defer up.Close()
	for rid, c := range costByReq {
		if _, err := up.Exec(c, rid); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) refreshTraces(tids []string) error {
	if len(tids) == 0 {
		return nil
	}
	args := anyStrings(tids)
	ph := placeholders(len(tids))
	if _, err := s.DB.Exec(`DELETE FROM trace_roots WHERE trace_id IN (`+ph+`)`, args...); err != nil {
		return err
	}
	if _, err := s.DB.Exec(`INSERT INTO trace_roots
		(trace_id, span_id, session_id, start_ns, end_ns, duration_ms, attrs, in_progress, span_count, history, repo, entrypoint, prompt)
		SELECT s.trace_id, s.span_id, s.session_id, s.start_ns, s.end_ns, s.duration_ms, s.attrs, false,
			(SELECT count(*) FROM spans x WHERE x.trace_id=s.trace_id),
			coalesce(json_extract_string(s.resource, '$."aftertrace.source"'), '') = 'history',
			a(s.attrs,'vcs.repository.name'), a(s.attrs,'app.entrypoint'),
			coalesce(a(s.attrs,'session.title'), a(s.attrs,'user_prompt'))
		FROM spans s WHERE s.name='claude_code.interaction' AND s.trace_id IN (`+ph+`)`, args...); err != nil {
		return fmt.Errorf("trace_roots interaction: %w", err)
	}
	if _, err := s.DB.Exec(`INSERT INTO trace_roots
		(trace_id, span_id, session_id, start_ns, end_ns, duration_ms, attrs, in_progress, span_count, history)
		SELECT o.trace_id, arg_max(o.parent_id, o.n), any_value(o.session_id), t.st, t.en, (t.en-t.st)/1e6, NULL::JSON, true, t.nspans,
			bool_or(o.hist)
		FROM (
			SELECT s.trace_id, s.parent_span_id AS parent_id, count(*) AS n, any_value(s.session_id) AS session_id,
				bool_or(coalesce(json_extract_string(s.resource, '$."aftertrace.source"'), '') = 'history') AS hist
			FROM spans s
			WHERE s.trace_id IN (`+ph+`)
				AND coalesce(s.parent_span_id, '') <> '' AND s.name LIKE 'claude_code.%'
				AND NOT EXISTS (SELECT 1 FROM spans i WHERE i.trace_id=s.trace_id AND i.name='claude_code.interaction')
				AND NOT EXISTS (SELECT 1 FROM spans p WHERE p.trace_id=s.trace_id AND p.span_id=s.parent_span_id)
			GROUP BY 1, 2
		) o
		JOIN (SELECT trace_id, min(start_ns) AS st, max(end_ns) AS en, count(*) AS nspans FROM spans WHERE trace_id IN (`+ph+`) GROUP BY 1) t
			USING (trace_id)
		GROUP BY o.trace_id, t.st, t.en, t.nspans`, append(args, args...)...); err != nil {
		return fmt.Errorf("trace_roots in_progress: %w", err)
	}
	if _, err := s.DB.Exec(`UPDATE trace_roots t SET
		wait_ms = (SELECT coalesce(sum(duration_ms),0) FROM spans WHERE trace_id=t.trace_id AND name='claude_code.tool.blocked_on_user'),
		errors = (SELECT count(*) FROM spans WHERE trace_id=t.trace_id AND is_error),
		tool_calls = (SELECT count(*) FROM spans WHERE trace_id=t.trace_id AND name='claude_code.tool'),
		approvals = (SELECT count(*) FROM spans WHERE trace_id=t.trace_id AND name='claude_code.tool.blocked_on_user'
			AND a(attrs,'source') IN ('user_temporary','user_permanent','user_abort','user_reject')),
		cost_usd = (SELECT coalesce(sum(cost_usd),0) FROM llm_facts WHERE trace_id=t.trace_id),
		tokens = (SELECT coalesce(sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)+coalesce(cache_read_tokens,0)+coalesce(cache_creation_tokens,0)),0) FROM llm_facts WHERE trace_id=t.trace_id),
		requests = (SELECT count(*) FROM llm_facts WHERE trace_id=t.trace_id)
		WHERE t.trace_id IN (`+ph+`)`, args...); err != nil {
		return fmt.Errorf("trace_roots facts: %w", err)
	}
	return s.refreshBreakdowns(tids)
}

func (s *Store) refreshBreakdowns(tids []string) error {
	if len(tids) == 0 {
		return nil
	}
	args := anyStrings(tids)
	ph := placeholders(len(tids))
	byTrace := map[string][]analysis.Span{}
	rows, err := s.DB.Query(`SELECT trace_id, span_id, coalesce(parent_span_id,''), name, start_ns, end_ns, duration_ms, is_error, coalesce(attrs::VARCHAR,'{}')
		FROM spans WHERE trace_id IN (`+ph+`) AND name IN (
			'claude_code.interaction','claude_code.tool.blocked_on_user','claude_code.tool.execution',
			'claude_code.hook','claude_code.llm_request')
		ORDER BY trace_id, start_ns`, args...)
	if err != nil {
		return err
	}
	for rows.Next() {
		var tid, attrs string
		var sp analysis.Span
		if err := rows.Scan(&tid, &sp.SpanID, &sp.ParentSpanID, &sp.Name, &sp.StartNS, &sp.EndNS, &sp.DurationMS, &sp.IsError, &attrs); err != nil {
			rows.Close()
			return err
		}
		_ = json.Unmarshal([]byte(attrs), &sp.Attrs)
		if sp.Attrs == nil {
			sp.Attrs = map[string]any{}
		}
		byTrace[tid] = append(byTrace[tid], sp)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	sources := map[string]map[string]string{}
	sr, err := s.DB.Query(`SELECT coalesce(trace_id,''), coalesce(span_id,''), coalesce(json_extract_string(attrs,'$.source'),'')
		FROM events WHERE name='tool_decision' AND trace_id IN (`+ph+`)`, args...)
	if err == nil {
		for sr.Next() {
			var tid, sid, src string
			if sr.Scan(&tid, &sid, &src) == nil && tid != "" && sid != "" {
				if sources[tid] == nil {
					sources[tid] = map[string]string{}
				}
				sources[tid][sid] = src
			}
		}
		sr.Close()
	}
	retry := map[string]map[string]*int64{}
	rr, err := s.DB.Query(`SELECT trace_id, span_id, max(time_ns), count(*) FROM span_events
		WHERE name='gen_ai.request.attempt' AND trace_id IN (`+ph+`) GROUP BY 1, 2`, args...)
	if err == nil {
		for rr.Next() {
			var tid, sid string
			var ts int64
			var n int
			if rr.Scan(&tid, &sid, &ts, &n) == nil && n > 1 {
				if retry[tid] == nil {
					retry[tid] = map[string]*int64{}
				}
				v := ts
				retry[tid][sid] = &v
			}
		}
		rr.Close()
	}
	hooks := map[string][][2]int64{}
	hr, err := s.DB.Query(`SELECT trace_id, ts_ns, n(attrs,'total_duration_ms') FROM events
		WHERE name='hook_execution_complete' AND trace_id IN (`+ph+`)`, args...)
	if err == nil {
		for hr.Next() {
			var tid string
			var ts int64
			var d sql.NullFloat64
			if hr.Scan(&tid, &ts, &d) == nil && d.Valid {
				hooks[tid] = append(hooks[tid], [2]int64{ts - int64(d.Float64*1e6), ts})
			}
		}
		hr.Close()
	}

	up, err := s.DB.Prepare(`UPDATE trace_roots SET breakdown=?::JSON, models=?::JSON WHERE trace_id=?`)
	if err != nil {
		return err
	}
	defer up.Close()
	for tid, spans := range byTrace {
		bd := analysis.BreakdownOffline(spans, sources[tid], retry[tid], hooks[tid])
		models := []string{}
		seen := map[string]bool{}
		for _, sp := range spans {
			if sp.Name != "claude_code.llm_request" {
				continue
			}
			m, _ := sp.Attrs["model"].(string)
			if m != "" && !seen[m] {
				seen[m] = true
				models = append(models, m)
			}
		}
		if _, err := up.Exec(asJSONMap(bd), asJSONSlice(models), tid); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) refreshSessions(sids []string) error {
	if len(sids) == 0 {
		return nil
	}
	args := anyStrings(sids)
	ph := placeholders(len(sids))
	if _, err := s.DB.Exec(`DELETE FROM session_stats WHERE session_id IN (`+ph+`)`, args...); err != nil {
		return err
	}
	if _, err := s.DB.Exec(`INSERT INTO session_stats
		(session_id, start_ns, end_ns, turns, turn_ms, cost_usd, tokens, errors, repo, entrypoint, title, breakdown, models, in_progress, history, retried, cache_hit, agents, findings)
		SELECT t.session_id, min(t.start_ns), max(t.end_ns), count(*), coalesce(sum(t.duration_ms),0),
			coalesce(sum(t.cost_usd),0), coalesce(sum(t.tokens),0), coalesce(sum(t.errors),0),
			any_value(t.repo), any_value(t.entrypoint),
			any_value(t.prompt),
			'{}'::JSON, '[]'::JSON,
			bool_or(t.in_progress), bool_or(t.history), 0, NULL, '[]'::JSON, 0
		FROM trace_roots t WHERE t.session_id IN (`+ph+`) GROUP BY t.session_id`, args...); err != nil {
		return fmt.Errorf("session_stats: %w", err)
	}
	// Merge per-trace breakdown JSON in Go (small N).
	rows, err := s.DB.Query(`SELECT session_id, coalesce(breakdown::VARCHAR,'{}'), coalesce(models::VARCHAR,'[]')
		FROM trace_roots WHERE session_id IN (`+ph+`)`, args...)
	if err != nil {
		return err
	}
	bd := map[string]map[string]float64{}
	models := map[string][]string{}
	seenM := map[string]map[string]bool{}
	for rows.Next() {
		var sid, bjs, mjs string
		if err := rows.Scan(&sid, &bjs, &mjs); err != nil {
			rows.Close()
			return err
		}
		var part map[string]float64
		_ = json.Unmarshal([]byte(bjs), &part)
		if bd[sid] == nil {
			bd[sid] = map[string]float64{}
		}
		for k, v := range part {
			bd[sid][k] += v
		}
		var ms []string
		_ = json.Unmarshal([]byte(mjs), &ms)
		if seenM[sid] == nil {
			seenM[sid] = map[string]bool{}
		}
		for _, m := range ms {
			if m != "" && !seenM[sid][m] {
				seenM[sid][m] = true
				models[sid] = append(models[sid], m)
			}
		}
	}
	rows.Close()
	up, err := s.DB.Prepare(`UPDATE session_stats SET breakdown=?::JSON, models=?::JSON, cache_hit=?, retried=?, title=coalesce(nullif(title,''), ?), agents=?::JSON WHERE session_id=?`)
	if err != nil {
		return err
	}
	defer up.Close()
	for _, sid := range sids {
		var hit sql.NullFloat64
		var retried int
		_ = s.DB.QueryRow(`SELECT sum(cache_read_tokens)/nullif(sum(cache_read_tokens+cache_creation_tokens+input_tokens),0),
			count(*) FILTER (WHERE coalesce(attempt,0)>1) FROM llm_facts WHERE session_id=?`, sid).Scan(&hit, &retried)
		var title sql.NullString
		_ = s.DB.QueryRow(`SELECT coalesce(
			(SELECT substr(a(attrs,'prompt'),1,8000) FROM events WHERE name='user_prompt' AND session_id=?
				AND a(attrs,'prompt') IS NOT NULL AND a(attrs,'prompt') NOT IN ('<REDACTED>','[REDACTED]') ORDER BY ts_ns LIMIT 1),
			(SELECT a(attrs,'session.title') FROM spans WHERE name='claude_code.interaction' AND session_id=?
				AND a(attrs,'session.title') IS NOT NULL ORDER BY start_ns LIMIT 1)
		)`, sid, sid).Scan(&title)
		agents := []string{}
		ar, err := s.DB.Query(`SELECT DISTINCT a(attrs,'agent_type') FROM events WHERE name='subagent_completed' AND session_id=? AND a(attrs,'agent_type') IS NOT NULL`, sid)
		if err == nil {
			for ar.Next() {
				var a string
				if ar.Scan(&a) == nil && a != "" {
					agents = append(agents, a)
				}
			}
			ar.Close()
		}
		if _, err := up.Exec(asJSONMap(bd[sid]), asJSONSlice(models[sid]), nullFloat(hit), retried, nullEmpty(title.String), asJSONSlice(agents), sid); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) refreshDaysForTraces(tids []string) error {
	if len(tids) == 0 {
		return nil
	}
	rows, err := s.DB.Query(`SELECT start_ns FROM trace_roots WHERE trace_id IN (`+placeholders(len(tids))+`)`, anyStrings(tids)...)
	if err != nil {
		return err
	}
	days := map[int64]struct{}{}
	for rows.Next() {
		var ns int64
		if rows.Scan(&ns) == nil {
			days[dayStart(ns)] = struct{}{}
		}
	}
	rows.Close()
	return s.refreshDays(keysInt(days))
}

func (s *Store) refreshDays(starts []int64) error {
	if len(starts) == 0 {
		return nil
	}
	del, err := s.DB.Prepare(`DELETE FROM day_stats WHERE day_start_ns=?`)
	if err != nil {
		return err
	}
	defer del.Close()
	ins, err := s.DB.Prepare(`INSERT INTO day_stats (day_start_ns, turns, turn_ms, wait_ms, cost_usd, tokens, by_model)
		VALUES (?,?,?,?,?,?,?::JSON)`)
	if err != nil {
		return err
	}
	defer ins.Close()
	for _, lo := range starts {
		hi := lo + int64(24*time.Hour)
		if _, err := del.Exec(lo); err != nil {
			return err
		}
		var turns int
		var turnMS, waitMS, cost, tokens sql.NullFloat64
		if err := s.DB.QueryRow(`SELECT count(*), coalesce(sum(duration_ms),0), coalesce(sum(wait_ms),0), coalesce(sum(cost_usd),0), coalesce(sum(tokens),0)
			FROM trace_roots WHERE start_ns>=? AND start_ns<?`, lo, hi).Scan(&turns, &turnMS, &waitMS, &cost, &tokens); err != nil {
			return err
		}
		if turns == 0 {
			continue
		}
		byModel := []map[string]any{}
		mr, err := s.DB.Query(`SELECT coalesce(model,'(none)'), coalesce(sum(cost_usd),0),
			coalesce(sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)+coalesce(cache_read_tokens,0)+coalesce(cache_creation_tokens,0)),0)
			FROM llm_facts WHERE start_ns>=? AND start_ns<? GROUP BY 1 ORDER BY 2 DESC`, lo, hi)
		if err == nil {
			for mr.Next() {
				var m string
				var c, tok float64
				if mr.Scan(&m, &c, &tok) == nil {
					byModel = append(byModel, map[string]any{"model": m, "cost_usd": c, "tokens": tok})
				}
			}
			mr.Close()
		}
		if _, err := ins.Exec(lo, turns, turnMS.Float64, waitMS.Float64, cost.Float64, tokens.Float64, asJSONSliceAny(byModel)); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) refreshModels() error {
	if _, err := s.DB.Exec(`DELETE FROM model_stats`); err != nil {
		return err
	}
	_, err := s.DB.Exec(`INSERT INTO model_stats (model, cost_usd, tokens, requests)
		SELECT coalesce(nullif(model,''),'(none)'), coalesce(sum(cost_usd),0),
			coalesce(sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)+coalesce(cache_read_tokens,0)+coalesce(cache_creation_tokens,0)),0),
			count(*) FROM llm_facts GROUP BY 1`)
	return err
}

func (s *Store) bumpSources(spans []Span, evs []Event, pts []MetricPoint) error {
	type acc struct {
		spans, events, metrics int64
		first, last            int64
	}
	m := map[string]*acc{}
	add := func(name string, kind string, t0, t1 int64) {
		if name == "" {
			name = "unknown"
		}
		a := m[name]
		if a == nil {
			a = &acc{first: t0, last: t1}
			m[name] = a
		}
		switch kind {
		case "spans":
			a.spans++
		case "events":
			a.events++
		case "metrics":
			a.metrics++
		}
		if t0 < a.first || a.first == 0 {
			a.first = t0
		}
		if t1 > a.last {
			a.last = t1
		}
	}
	for _, sp := range spans {
		add(strAttr(sp.Resource, "service.name"), "spans", sp.StartNS, sp.EndNS)
	}
	for _, e := range evs {
		add(strAttr(e.Resource, "service.name"), "events", e.TsNS, e.TsNS)
	}
	for _, p := range pts {
		add(strAttr(p.Resource, "service.name"), "metrics", p.TsNS, p.TsNS)
	}
	if len(m) == 0 {
		return nil
	}
	stmt, err := s.DB.Prepare(`INSERT INTO source_stats (name, kind, spans, events, metrics, first_ns, last_ns)
		VALUES (?,?,?,?,?,?,?)
		ON CONFLICT (name) DO UPDATE SET
			spans = source_stats.spans + excluded.spans,
			events = source_stats.events + excluded.events,
			metrics = source_stats.metrics + excluded.metrics,
			first_ns = least(source_stats.first_ns, excluded.first_ns),
			last_ns = greatest(source_stats.last_ns, excluded.last_ns)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for name, a := range m {
		kind := "app"
		if strings.HasPrefix(name, "claude-code") {
			kind = "claude-code"
		}
		if _, err := stmt.Exec(name, kind, a.spans, a.events, a.metrics, a.first, a.last); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) bumpCounts(spans, sevs, evs, pts int) error {
	if spans == 0 && sevs == 0 && evs == 0 && pts == 0 {
		return nil
	}
	add := func(k string, n int) error {
		if n == 0 {
			return nil
		}
		_, err := s.DB.Exec(`INSERT INTO store_meta (k, v) VALUES (?, ?)
			ON CONFLICT (k) DO UPDATE SET v = CAST(CAST(store_meta.v AS BIGINT) + CAST(excluded.v AS BIGINT) AS VARCHAR)`, k, fmt.Sprintf("%d", n))
		return err
	}
	if err := add(metaSpans, spans); err != nil {
		return err
	}
	if err := add(metaSpanEvents, sevs); err != nil {
		return err
	}
	if err := add(metaEvents, evs); err != nil {
		return err
	}
	return add(metaMetrics, pts)
}

func (s *Store) noteOrigin(spans []Span, evs []Event, pts []MetricPoint) {
	set := func(k string) {
		_, _ = s.DB.Exec(`INSERT OR REPLACE INTO store_meta (k, v) VALUES (?, '1')`, k)
	}
	for _, sp := range spans {
		if isHistory(sp.Resource) {
			set(metaHistory)
		} else if strAttr(sp.Resource, "service.name") != "" || sp.Name != "" {
			set(metaLiveOTel)
		}
	}
	for _, e := range evs {
		if isHistory(e.Resource) {
			set(metaHistory)
		} else if e.Name != "" {
			set(metaLiveOTel)
		}
	}
	_ = pts
}

func (s *Store) dropRollupsLocked(ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	ph := placeholders(len(ids))
	args := anyStrings(ids)
	for _, q := range []string{
		`DELETE FROM llm_facts WHERE session_id IN (` + ph + `)`,
		`DELETE FROM trace_roots WHERE session_id IN (` + ph + `)`,
		`DELETE FROM session_stats WHERE session_id IN (` + ph + `)`,
	} {
		if _, err := s.DB.Exec(q, args...); err != nil {
			return err
		}
	}
	return nil
}

// EnsureRollups backfills materialized tables for a store opened from an older
// file. Skipped when there are no interaction turns (the RSS pad seed) or when
// rows already exist.
func (s *Store) EnsureRollups() error {
	if s == nil || s.DB == nil {
		return nil
	}
	var n int
	if err := s.DB.QueryRow(`SELECT count(*) FROM trace_roots`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	if err := s.DB.QueryRow(`SELECT count(*) FROM spans WHERE name='claude_code.interaction'`).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		return nil
	}
	s.wmu.Lock()
	defer s.wmu.Unlock()
	return s.rebuildAllLocked()
}

func (s *Store) rebuildAllLocked() error {
	if _, err := s.DB.Exec(`DELETE FROM llm_facts`); err != nil {
		return err
	}
	if _, err := s.DB.Exec(`INSERT INTO llm_facts
		(trace_id, span_id, session_id, start_ns, model, request_id, cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, is_error, attempt)
		SELECT s.trace_id, s.span_id, s.session_id, s.start_ns, a(s.attrs,'model'), a(s.attrs,'request_id'),
			coalesce(n(e.attrs,'cost_usd'), n(s.attrs,'cost_usd')),
			n(s.attrs,'input_tokens'), n(s.attrs,'output_tokens'), n(s.attrs,'cache_read_tokens'), n(s.attrs,'cache_creation_tokens'),
			s.is_error, n(s.attrs,'attempt')
		FROM spans s LEFT JOIN events e ON e.name='api_request' AND e.request_id = a(s.attrs,'request_id')
		WHERE s.name='claude_code.llm_request'`); err != nil {
		return fmt.Errorf("backfill llm_facts: %w", err)
	}
	rows, err := s.DB.Query(`SELECT DISTINCT trace_id FROM spans WHERE name='claude_code.interaction'
		UNION SELECT DISTINCT trace_id FROM spans s WHERE s.name LIKE 'claude_code.%' AND coalesce(s.parent_span_id,'') <> ''
			AND NOT EXISTS (SELECT 1 FROM spans i WHERE i.trace_id=s.trace_id AND i.name='claude_code.interaction')
			AND NOT EXISTS (SELECT 1 FROM spans p WHERE p.trace_id=s.trace_id AND p.span_id=s.parent_span_id)`)
	if err != nil {
		return err
	}
	var tids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil && id != "" {
			tids = append(tids, id)
		}
	}
	rows.Close()
	const batch = 80
	for i := 0; i < len(tids); i += batch {
		j := i + batch
		if j > len(tids) {
			j = len(tids)
		}
		if err := s.refreshTraces(tids[i:j]); err != nil {
			return err
		}
	}
	srows, err := s.DB.Query(`SELECT DISTINCT session_id FROM trace_roots WHERE session_id IS NOT NULL`)
	if err != nil {
		return err
	}
	var sids []string
	for srows.Next() {
		var id string
		if srows.Scan(&id) == nil && id != "" {
			sids = append(sids, id)
		}
	}
	srows.Close()
	if err := s.refreshSessions(sids); err != nil {
		return err
	}
	drows, err := s.DB.Query(`SELECT DISTINCT start_ns FROM trace_roots`)
	if err != nil {
		return err
	}
	days := map[int64]struct{}{}
	for drows.Next() {
		var ns int64
		if drows.Scan(&ns) == nil {
			days[dayStart(ns)] = struct{}{}
		}
	}
	drows.Close()
	if err := s.refreshDays(keysInt(days)); err != nil {
		return err
	}
	if err := s.refreshModels(); err != nil {
		return err
	}
	if _, err := s.DB.Exec(`DELETE FROM source_stats`); err != nil {
		return err
	}
	if _, err := s.DB.Exec(`INSERT INTO source_stats (name, kind, spans, events, metrics, first_ns, last_ns)
		SELECT svc,
			CASE WHEN svc LIKE 'claude-code%' THEN 'claude-code' ELSE 'app' END,
			count(*) FILTER (WHERE k='spans'), count(*) FILTER (WHERE k='events'), count(*) FILTER (WHERE k='metrics'),
			min(t0), max(t1)
		FROM (
			SELECT coalesce(json_extract_string(resource, '$."service.name"'), 'unknown') AS svc, 'spans' AS k, start_ns AS t0, end_ns AS t1 FROM spans
			UNION ALL SELECT coalesce(json_extract_string(resource, '$."service.name"'), 'unknown'), 'events', ts_ns, ts_ns FROM events
			UNION ALL SELECT coalesce(json_extract_string(resource, '$."service.name"'), 'unknown'), 'metrics', ts_ns, ts_ns FROM metric_points
		) r GROUP BY svc`); err != nil {
		return fmt.Errorf("source_stats: %w", err)
	}
	var c Counts
	_ = s.DB.QueryRow(`SELECT (SELECT count(*) FROM spans),(SELECT count(*) FROM span_events),(SELECT count(*) FROM events),(SELECT count(*) FROM metric_points)`).
		Scan(&c.Spans, &c.SpanEvents, &c.Events, &c.MetricPoints)
	_ = s.setMeta(metaSpans, fmt.Sprintf("%d", c.Spans))
	_ = s.setMeta(metaSpanEvents, fmt.Sprintf("%d", c.SpanEvents))
	_ = s.setMeta(metaEvents, fmt.Sprintf("%d", c.Events))
	_ = s.setMeta(metaMetrics, fmt.Sprintf("%d", c.MetricPoints))
	var hist, live int
	_ = s.DB.QueryRow(`SELECT count(*) FROM spans WHERE coalesce(json_extract_string(resource, '$."aftertrace.source"'), '') = 'history'`).Scan(&hist)
	_ = s.DB.QueryRow(`SELECT count(*) FROM spans WHERE coalesce(json_extract_string(resource, '$."aftertrace.source"'), '') <> 'history'`).Scan(&live)
	if hist > 0 {
		_ = s.setMeta(metaHistory, "1")
	}
	if live > 0 {
		_ = s.setMeta(metaLiveOTel, "1")
	}
	return nil
}

func (s *Store) setMeta(k, v string) error {
	_, err := s.DB.Exec(`INSERT OR REPLACE INTO store_meta (k, v) VALUES (?, ?)`, k, v)
	return err
}

func (s *Store) Meta(k string) string {
	var v sql.NullString
	_ = s.DB.QueryRow(`SELECT v FROM store_meta WHERE k=?`, k).Scan(&v)
	return v.String
}

func (s *Store) CachedCounts() (Counts, bool) {
	var c Counts
	ok := true
	scan := func(k string, dst *int) {
		v := s.Meta(k)
		if v == "" {
			ok = false
			return
		}
		fmt.Sscanf(v, "%d", dst)
	}
	scan(metaSpans, &c.Spans)
	scan(metaSpanEvents, &c.SpanEvents)
	scan(metaEvents, &c.Events)
	scan(metaMetrics, &c.MetricPoints)
	return c, ok
}

func (s *Store) HasHistoryFlag() bool { return s.Meta(metaHistory) == "1" }
func (s *Store) LiveOTelFlag() bool   { return s.Meta(metaLiveOTel) == "1" }

func (s *Store) SetSessionFindings(counts map[string]int) error {
	if s == nil || s.DB == nil {
		return nil
	}
	s.wmu.Lock()
	defer s.wmu.Unlock()
	if _, err := s.DB.Exec(`UPDATE session_stats SET findings=0`); err != nil {
		return err
	}
	if len(counts) == 0 {
		return nil
	}
	stmt, err := s.DB.Prepare(`UPDATE session_stats SET findings=? WHERE session_id=?`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for sid, n := range counts {
		if _, err := stmt.Exec(n, sid); err != nil {
			return err
		}
	}
	return nil
}

func dayStart(ns int64) int64 {
	t := time.Unix(0, ns).Local()
	d := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
	return d.UnixNano()
}

func strAttr(m map[string]any, k string) string {
	if m == nil {
		return ""
	}
	v, _ := m[k].(string)
	return v
}

func numAttr(m map[string]any, k string) (float64, bool) {
	if m == nil {
		return 0, false
	}
	switch v := m[k].(type) {
	case float64:
		return v, true
	case json.Number:
		f, err := v.Float64()
		return f, err == nil
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	}
	return 0, false
}

func keys(m map[string]struct{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func keysInt(m map[int64]struct{}) []int64 {
	out := make([]int64, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func anyStrings(s []string) []any {
	out := make([]any, len(s))
	for i, v := range s {
		out[i] = v
	}
	return out
}

func asJSONMap(m map[string]float64) string {
	if m == nil {
		return `{}`
	}
	b, err := json.Marshal(m)
	if err != nil {
		return `{}`
	}
	return string(b)
}

func asJSONSlice(s []string) string {
	if s == nil {
		s = []string{}
	}
	b, err := json.Marshal(s)
	if err != nil {
		return `[]`
	}
	return string(b)
}

func asJSONSliceAny(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return `[]`
	}
	return string(b)
}

func nullZero(f float64) any {
	if f == 0 {
		return nil
	}
	return f
}

func nullFloat(n sql.NullFloat64) any {
	if !n.Valid {
		return nil
	}
	return n.Float64
}
