package api

import (
	"database/sql"
	"encoding/json"
	"strconv"

	"github.com/RahulKraken/aftertrace/internal/analysis"
	"github.com/RahulKraken/aftertrace/internal/rules"
)

func sessions(db *sql.DB) ([]map[string]any, error) {
	findings := rules.RunAll(db)
	rows, err := db.Query(`
		SELECT r.session_id, min(r.start_ns), max(r.end_ns), count(*), sum(r.duration_ms),
			any_value(a(r.attrs,'vcs.repository.name')), any_value(a(r.attrs,'app.entrypoint')),
			list(r.trace_id)
		FROM spans r WHERE r.name='claude_code.interaction' GROUP BY r.session_id ORDER BY min(r.start_ns) DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var sid string
		var st, en int64
		var turns int
		var turnMS float64
		var repo, entry sql.NullString
		var tidsRaw any
		if err := rows.Scan(&sid, &st, &en, &turns, &turnMS, &repo, &entry, &tidsRaw); err != nil {
			return nil, err
		}
		tids := asStringSlice(tidsRaw)
		var cost, tokens, cacheHit sql.NullFloat64
		var modelsRaw any
		var errors, retried sql.NullInt64
		err := db.QueryRow(`SELECT sum(cost_usd), sum(input_tokens+output_tokens+cache_read_tokens+cache_creation_tokens),
			sum(cache_read_tokens)/nullif(sum(cache_read_tokens+cache_creation_tokens+input_tokens),0),
			list(DISTINCT model), count(*) FILTER (WHERE is_error), count(*) FILTER (WHERE attempt>1)
			FROM llm WHERE session_id=?`, sid).Scan(&cost, &tokens, &cacheHit, &modelsRaw, &errors, &retried)
		if err != nil {
			return nil, err
		}
		agents := []string{}
		ar, err := db.Query(`SELECT DISTINCT a(attrs,'agent_type') FROM events WHERE name='subagent_completed' AND session_id=? AND a(attrs,'agent_type') IS NOT NULL`, sid)
		if err != nil {
			return nil, err
		}
		for ar.Next() {
			var a string
			if err := ar.Scan(&a); err == nil && a != "" {
				agents = append(agents, a)
			}
		}
		ar.Close()
		bd := map[string]float64{}
		for _, t := range tids {
			spans, err := analysis.SpanRows(db, t)
			if err != nil {
				return nil, err
			}
			for k, v := range analysis.Breakdown(db, t, spans) {
				bd[k] += v
			}
		}
		nf := 0
		for _, f := range findings {
			for _, sess := range f.Sessions {
				if sess == sid {
					nf++
					break
				}
			}
		}
		out = append(out, map[string]any{
			"session_id": sid,
			"start_ns":   st,
			"end_ns":     en,
			"turns":      turns,
			"turn_ms":    turnMS,
			"repo":       repo.String,
			"entrypoint": entry.String,
			"cost_usd":   nullNum(cost),
			"tokens":     nullNum(tokens),
			"cache_hit":  nullNum(cacheHit),
			"models":     asStringSlice(modelsRaw),
			"errors":     errors.Int64,
			"retried":    retried.Int64,
			"agents":     agents,
			"breakdown":  bd,
			"findings":   nf,
		})
	}
	if out == nil {
		out = []map[string]any{}
	}
	return out, rows.Err()
}

func sessionDetail(db *sql.DB, sid string) (map[string]any, error) {
	ss, err := sessions(db)
	if err != nil {
		return nil, err
	}
	var sess any
	for _, s := range ss {
		if s["session_id"] == sid {
			sess = s
			break
		}
	}
	rows, err := db.Query(`SELECT trace_id, span_id, start_ns, duration_ms, n(attrs,'interaction.sequence')
		FROM spans WHERE name='claude_code.interaction' AND session_id=? ORDER BY start_ns`, sid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var turns []map[string]any
	for rows.Next() {
		var tid, sp string
		var st int64
		var d float64
		var seq sql.NullFloat64
		if err := rows.Scan(&tid, &sp, &st, &d, &seq); err != nil {
			return nil, err
		}
		var cost sql.NullFloat64
		var reqs int
		var modelsRaw any
		if err := db.QueryRow(`SELECT sum(cost_usd), count(*), list(DISTINCT model) FROM llm WHERE trace_id=?`, tid).
			Scan(&cost, &reqs, &modelsRaw); err != nil {
			return nil, err
		}
		var tools int
		if err := db.QueryRow(`SELECT count(*) FROM tools WHERE trace_id=?`, tid).Scan(&tools); err != nil {
			return nil, err
		}
		spans, err := analysis.SpanRows(db, tid)
		if err != nil {
			return nil, err
		}
		turns = append(turns, map[string]any{
			"trace_id":    tid,
			"span_id":     sp,
			"start_ns":    st,
			"duration_ms": d,
			"seq":         seq.Float64,
			"cost_usd":    nullNum(cost),
			"requests":    reqs,
			"models":      asStringSlice(modelsRaw),
			"tools":       tools,
			"breakdown":   analysis.Breakdown(db, tid, spans),
		})
	}
	if turns == nil {
		turns = []map[string]any{}
	}
	return map[string]any{"session": sess, "turns": turns}, rows.Err()
}

func traceDetail(db *sql.DB, tid string) (map[string]any, error) {
	spans, err := analysis.SpanRows(db, tid)
	if err != nil {
		return nil, err
	}
	crit := analysis.CriticalPath(spans)
	findings := rules.RunAll(db)
	spanFindings := map[string][]int{}
	for _, f := range findings {
		for _, e := range f.Evidence {
			spanFindings[e.SpanID] = append(spanFindings[e.SpanID], f.ID)
		}
	}
	joined := map[string]map[string]any{}
	rows, err := db.Query(`SELECT span_id, cost_usd, skill_name, agent_name, mcp_server_name, query_source FROM llm WHERE trace_id=?`, tid)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var sid string
		var cost sql.NullFloat64
		var skill, agent, mcp, qs sql.NullString
		if err := rows.Scan(&sid, &cost, &skill, &agent, &mcp, &qs); err != nil {
			rows.Close()
			return nil, err
		}
		joined[sid] = map[string]any{
			"cost_usd":        nullNum(cost),
			"skill.name":      nullStr(skill),
			"agent.name":      nullStr(agent),
			"mcp_server.name": nullStr(mcp),
			"query_source":    nullStr(qs),
		}
	}
	rows.Close()

	// Claude Code links tool_use_id and the permission decision through the
	// tool_decision event, not the spans. The tools view resolves both.
	toolUse := map[string]string{}
	waitDecision := map[string][2]string{}
	tr, err := db.Query(`SELECT span_id, coalesce(tool_use_id,''), coalesce(wait_span_id,''), coalesce(decision,''), coalesce(decision_source,'')
		FROM tools WHERE trace_id=?`, tid)
	if err != nil {
		return nil, err
	}
	for tr.Next() {
		var sid, tuid, wait, dec, src string
		if err := tr.Scan(&sid, &tuid, &wait, &dec, &src); err != nil {
			tr.Close()
			return nil, err
		}
		if tuid != "" {
			toolUse[sid] = tuid
		}
		if wait != "" && dec != "" {
			waitDecision[wait] = [2]string{dec, src}
		}
	}
	tr.Close()

	sevs := []map[string]any{}
	sr, err := db.Query(`SELECT span_id, name, time_ns, attrs::VARCHAR FROM span_events WHERE trace_id=? ORDER BY time_ns`, tid)
	if err != nil {
		return nil, err
	}
	for sr.Next() {
		var sid, name, attrs string
		var ts int64
		if err := sr.Scan(&sid, &name, &ts, &attrs); err != nil {
			sr.Close()
			return nil, err
		}
		sevs = append(sevs, map[string]any{"span_id": sid, "name": name, "time_ns": ts, "attrs": parseObj(attrs)})
	}
	sr.Close()

	evs := []map[string]any{}
	er, err := db.Query(`SELECT name, ts_ns, tool_use_id, request_id, attrs::VARCHAR FROM events WHERE trace_id=? ORDER BY ts_ns`, tid)
	if err != nil {
		return nil, err
	}
	for er.Next() {
		var name string
		var ts int64
		var tool, req, attrs sql.NullString
		if err := er.Scan(&name, &ts, &tool, &req, &attrs); err != nil {
			er.Close()
			return nil, err
		}
		evs = append(evs, map[string]any{
			"name": name, "ts_ns": ts, "tool_use_id": nullStr(tool), "request_id": nullStr(req), "attrs": parseObj(attrs.String),
		})
	}
	er.Close()

	outSpans := make([]analysis.Span, len(spans))
	for i, sp := range spans {
		sp.Critical = false
		if _, ok := crit[sp.SpanID]; ok {
			sp.Critical = true
		}
		if j, ok := joined[sp.SpanID]; ok {
			sp.Joined = j
		}
		if tuid, ok := toolUse[sp.SpanID]; ok && sp.Attrs["tool_use_id"] == nil {
			sp.Attrs["tool_use_id"] = tuid
		}
		if d, ok := waitDecision[sp.SpanID]; ok {
			if v, _ := sp.Attrs["decision"].(string); v == "" || v == "unknown" {
				sp.Attrs["decision"] = d[0]
			}
			if v, _ := sp.Attrs["source"].(string); (v == "" || v == "unknown") && d[1] != "" {
				sp.Attrs["source"] = d[1]
			}
		}
		sp.RetryEndNS = analysis.RetryEnd(db, tid, sp.SpanID)
		if ids := spanFindings[sp.SpanID]; len(ids) > 0 {
			sp.Findings = ids
		} else {
			sp.Findings = []int{}
		}
		outSpans[i] = sp
	}

	var sid string
	for _, sp := range outSpans {
		if sp.Name == "claude_code.interaction" {
			if v, ok := sp.Attrs["session.id"].(string); ok {
				sid = v
			}
			break
		}
	}
	sib := []string{}
	if sid != "" {
		sr, err := db.Query(`SELECT trace_id FROM spans WHERE name='claude_code.interaction' AND session_id=? ORDER BY start_ns`, sid)
		if err != nil {
			return nil, err
		}
		for sr.Next() {
			var t string
			if err := sr.Scan(&t); err == nil {
				sib = append(sib, t)
			}
		}
		sr.Close()
	}
	i := -1
	for k, t := range sib {
		if t == tid {
			i = k
			break
		}
	}
	var prev, next any
	if i > 0 {
		prev = sib[i-1]
	}
	if i >= 0 && i < len(sib)-1 {
		next = sib[i+1]
	}
	return map[string]any{
		"trace_id":    tid,
		"session_id":  sid,
		"spans":       outSpans,
		"span_events": sevs,
		"events":      evs,
		"breakdown":   analysis.Breakdown(db, tid, spans),
		"prev":        prev,
		"next":        next,
		"turn_index":  i + 1,
		"turn_count":  len(sib),
	}, nil
}

func cost(db *sql.DB, dim string) (map[string]any, error) {
	if dim == "tool" {
		rows, err := db.Query(`SELECT coalesce(tool_name,'?'), count(*), sum(result_tokens), sum(exec_ms)/1000, sum(wait_ms)/1000 FROM tools
			GROUP BY 1 ORDER BY 3 DESC`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out [][]any
		for rows.Next() {
			var name string
			var calls int64
			var toks, execS, waitS sql.NullFloat64
			if err := rows.Scan(&name, &calls, &toks, &execS, &waitS); err != nil {
				return nil, err
			}
			out = append(out, []any{name, calls, nullNum(toks), nullNum(execS), nullNum(waitS)})
		}
		if out == nil {
			out = [][]any{}
		}
		return map[string]any{
			"dim":     dim,
			"columns": []string{"tool_name", "calls", "result_tokens", "exec_s", "wait_s"},
			"rows":    out,
			"note":    "Tools carry no cost of their own. result_tokens is what the tool added to context.",
		}, nil
	}
	dims := map[string]string{
		"model": "model", "effort": "effort", "skill": "skill_name", "subagent": "agent_name",
		"mcp": "mcp_server_name", "repo": "repo", "query_source": "query_source",
	}
	col, ok := dims[dim]
	if !ok {
		return nil, errDim(dim)
	}
	var total sql.NullFloat64
	if err := db.QueryRow("SELECT sum(cost_usd) FROM llm").Scan(&total); err != nil {
		return nil, err
	}
	tot := 1.0
	if total.Valid && total.Float64 != 0 {
		tot = total.Float64
	}
	rows, err := db.Query(`SELECT coalesce(` + col + `, '(none)'), sum(cost_usd), sum(cost_usd)/` + strconvf(tot) + `, count(*),
		sum(input_tokens), sum(output_tokens), sum(cache_read_tokens), sum(cache_creation_tokens),
		sum(cache_read_tokens)/nullif(sum(cache_read_tokens+cache_creation_tokens+input_tokens),0)
		FROM llm WHERE NOT is_error GROUP BY 1 ORDER BY 2 DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out [][]any
	for rows.Next() {
		var name string
		var cost, share sql.NullFloat64
		var reqs int64
		var in, outp, cr, cw, hit sql.NullFloat64
		if err := rows.Scan(&name, &cost, &share, &reqs, &in, &outp, &cr, &cw, &hit); err != nil {
			return nil, err
		}
		out = append(out, []any{name, nullNum(cost), nullNum(share), reqs, nullNum(in), nullNum(outp), nullNum(cr), nullNum(cw), nullNum(hit)})
	}
	if out == nil {
		out = [][]any{}
	}
	return map[string]any{
		"dim":     dim,
		"columns": []string{dim, "cost_usd", "share", "requests", "input", "output", "cache_read", "cache_write", "cache_hit"},
		"rows":    out,
		"note":    "Cost is cost_usd from api_request events, joined to spans on request_id.",
	}, nil
}

type dimError string

func (e dimError) Error() string { return "unknown cost dimension: " + string(e) }
func errDim(d string) error      { return dimError(d) }

func strconvf(f float64) string { return strconv.FormatFloat(f, 'f', -1, 64) }

func nullNum(n sql.NullFloat64) any {
	if !n.Valid {
		return nil
	}
	return n.Float64
}
func nullStr(n sql.NullString) any {
	if !n.Valid {
		return nil
	}
	return n.String
}

func parseObj(s string) map[string]any {
	if s == "" {
		return map[string]any{}
	}
	var m map[string]any
	if json.Unmarshal([]byte(s), &m) != nil || m == nil {
		return map[string]any{}
	}
	return m
}

func asStringSlice(v any) []string {
	if v == nil {
		return []string{}
	}
	switch t := v.(type) {
	case []string:
		return t
	case []any:
		out := make([]string, 0, len(t))
		for _, x := range t {
			if x != nil {
				out = append(out, stringify(x))
			}
		}
		return out
	case string:
		var arr []string
		if json.Unmarshal([]byte(t), &arr) == nil {
			return arr
		}
		return []string{t}
	case []byte:
		var arr []string
		if json.Unmarshal(t, &arr) == nil {
			return arr
		}
		return []string{string(t)}
	default:
		b, err := json.Marshal(t)
		if err != nil {
			return []string{}
		}
		var arr []string
		if json.Unmarshal(b, &arr) == nil && arr != nil {
			return arr
		}
		var anyarr []any
		if json.Unmarshal(b, &anyarr) == nil {
			out := make([]string, 0, len(anyarr))
			for _, x := range anyarr {
				if x != nil {
					out = append(out, stringify(x))
				}
			}
			return out
		}
		return []string{}
	}
}

func stringify(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case []byte:
		return string(t)
	default:
		return jsonString(t)
	}
}

func jsonString(v any) string {
	b, err := json.Marshal(tweak(v))
	if err != nil {
		return ""
	}
	var s string
	if json.Unmarshal(b, &s) == nil {
		return s
	}
	return string(b)
}

func tweak(v any) any { return v }
