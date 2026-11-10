package api

import (
	"database/sql"
	"encoding/json"
	"strconv"
	"time"

	"github.com/RahulKraken/aftertrace/internal/analysis"
	"github.com/RahulKraken/aftertrace/internal/history"
)

func sessions(db *sql.DB) ([]map[string]any, error) {
	return sessionRows(db, 0, 0, 0, false)
}

func sessionRows(db *sql.DB, limit int, lo, hi int64, historyWindow bool) ([]map[string]any, error) {
	q := `SELECT session_id, start_ns, end_ns, turns, turn_ms, coalesce(repo,''), coalesce(entrypoint,''),
		cost_usd, tokens, cache_hit, coalesce(models::VARCHAR,'[]'), coalesce(errors,0), coalesce(retried,0),
		coalesce(agents::VARCHAR,'[]'), coalesce(breakdown::VARCHAR,'{}'), coalesce(findings,0), title,
		in_progress AND end_ns > ?
		FROM session_stats`
	args := []any{runningSince()}
	if historyWindow && lo > 0 {
		q += ` WHERE start_ns >= ? AND start_ns < ?`
		args = append(args, lo, hi)
	}
	q += ` ORDER BY start_ns DESC`
	if limit > 0 {
		q += ` LIMIT ?`
		args = append(args, limit)
	}
	rows, err := db.Query(q, args...)
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
		var repo, entry, mjs, ajs, bjs string
		var cost, tokens, hit sql.NullFloat64
		var errors, retried, findings int64
		var title sql.NullString
		var running bool
		if err := rows.Scan(&sid, &st, &en, &turns, &turnMS, &repo, &entry, &cost, &tokens, &hit, &mjs, &errors, &retried, &ajs, &bjs, &findings, &title, &running); err != nil {
			return nil, err
		}
		bd := map[string]float64{}
		_ = json.Unmarshal([]byte(bjs), &bd)
		out = append(out, map[string]any{
			"session_id": sid,
			"start_ns":   st,
			"end_ns":     en,
			"turns":      turns,
			"turn_ms":    turnMS,
			"repo":       repo,
			"entrypoint": entry,
			"cost_usd":   nullNum(cost),
			"tokens":     nullNum(tokens),
			"cache_hit":  nullNum(hit),
			"models":     asStringSlice(mjs),
			"errors":     errors,
			"retried":    retried,
			"agents":     asStringSlice(ajs),
			"breakdown":  bd,
			"findings":   findings,
			"title":      cleanTitle(title),
			"running":    running,
		})
	}
	if out == nil {
		out = []map[string]any{}
	}
	return out, rows.Err()
}

func sessionDetail(db *sql.DB, sid string) (map[string]any, error) {
	one, err := sessionRows(db, 0, 0, 0, false)
	if err != nil {
		return nil, err
	}
	var sess any
	for _, s := range one {
		if s["session_id"] == sid {
			sess = s
			break
		}
	}
	rows, err := db.Query(`SELECT trace_id, span_id, start_ns, duration_ms, n(attrs,'interaction.sequence'), in_progress, in_progress AND end_ns > ?,
		coalesce(cost_usd,0), coalesce(requests,0), coalesce(models::VARCHAR,'[]'), coalesce(tool_calls,0), coalesce(breakdown::VARCHAR,'{}'), prompt
		FROM trace_roots WHERE session_id=? ORDER BY start_ns`, runningSince(), sid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var turns []map[string]any
	for rows.Next() {
		var tid, sp, mjs, bjs string
		var st int64
		var d float64
		var seq sql.NullFloat64
		var pending, running bool
		var cost float64
		var reqs, tools int
		var prompt sql.NullString
		if err := rows.Scan(&tid, &sp, &st, &d, &seq, &pending, &running, &cost, &reqs, &mjs, &tools, &bjs, &prompt); err != nil {
			return nil, err
		}
		bd := map[string]float64{}
		_ = json.Unmarshal([]byte(bjs), &bd)
		turns = append(turns, map[string]any{
			"trace_id":    tid,
			"span_id":     sp,
			"start_ns":    st,
			"duration_ms": d,
			"seq":         seq.Float64,
			"cost_usd":    cost,
			"requests":    reqs,
			"models":      asStringSlice(mjs),
			"tools":       tools,
			"breakdown":   bd,
			"prompt":      cleanTitle(prompt),
			"in_progress": pending,
			"running":     running,
		})
	}
	if turns == nil {
		turns = []map[string]any{}
	}
	return map[string]any{"session": sess, "turns": turns}, rows.Err()
}

// A turn without its interaction span counts as running while spans keep
// arriving. After that it is incomplete: Claude Code exited mid-turn.
func runningSince() int64 { return time.Now().Add(-5 * time.Minute).UnixNano() }

// Claude Code writes "<REDACTED>" in place of content unless the matching
// OTEL_LOG_* flag is on. Treat that the same as absent.
func notRedacted(expr string) string {
	return expr + ` IS NOT NULL AND ` + expr + ` NOT IN ('<REDACTED>', '[REDACTED]')`
}

// turnPrompt is the text the user typed for one turn: the user_prompt event,
// else the interaction span's own user_prompt attribute.
func turnPrompt(db *sql.DB, tid string) (sql.NullString, error) {
	var p sql.NullString
	err := db.QueryRow(`SELECT coalesce(
		(SELECT a(attrs,'prompt') FROM events WHERE name='user_prompt' AND trace_id=? AND `+notRedacted("a(attrs,'prompt')")+` ORDER BY ts_ns LIMIT 1),
		(SELECT a(attrs,'user_prompt') FROM spans WHERE name='claude_code.interaction' AND trace_id=? AND `+notRedacted("a(attrs,'user_prompt')")+` LIMIT 1))`,
		tid, tid).Scan(&p)
	return p, err
}

func traceDetail(db *sql.DB, tid string) (map[string]any, error) {
	spans, err := analysis.SpanRows(db, tid)
	if err != nil {
		return nil, err
	}
	crit := analysis.CriticalPath(spans)
	findings := findingsFor(db)
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

	// Model calls from apps: cost (reported or priced), model and provider.
	cr, err := db.Query(`SELECT span_id, cost_usd, model, provider, cost_reported FROM calls WHERE trace_id=?`, tid)
	if err != nil {
		return nil, err
	}
	for cr.Next() {
		var sid string
		var cost sql.NullFloat64
		var model, provider sql.NullString
		var reported bool
		if err := cr.Scan(&sid, &cost, &model, &provider, &reported); err != nil {
			cr.Close()
			return nil, err
		}
		joined[sid] = map[string]any{
			"cost_usd": nullNum(cost), "model": nullStr(model), "provider": nullStr(provider),
			"cost_estimated": !reported, "app_call": true,
		}
	}
	cr.Close()

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
	inProgress := false
	for _, sp := range outSpans {
		if sp.Name == "claude_code.interaction" {
			inProgress = sp.Attrs[analysis.InProgressAttr] == true
			if v, ok := sp.Attrs["session.id"].(string); ok {
				sid = v
			}
			break
		}
	}
	sib := []string{}
	if sid != "" {
		sr, err := db.Query(`SELECT trace_id FROM turn_roots WHERE session_id=? ORDER BY start_ns`, sid)
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
		"in_progress": inProgress,
		"service":     traceService(db, tid),
	}, nil
}

func cost(db *sql.DB, dim string) (map[string]any, error) {
	if dim == "model" {
		rows, err := db.Query(`SELECT model, cost_usd, requests, tokens FROM model_stats ORDER BY cost_usd DESC`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var total float64
		var out [][]any
		type row struct {
			name      string
			cost, tok float64
			reqs      int64
		}
		var tmp []row
		for rows.Next() {
			var r row
			if err := rows.Scan(&r.name, &r.cost, &r.reqs, &r.tok); err != nil {
				return nil, err
			}
			total += r.cost
			tmp = append(tmp, r)
		}
		den := total
		if den == 0 {
			den = 1
		}
		for _, r := range tmp {
			out = append(out, []any{r.name, r.cost, r.cost / den, r.reqs, nil, nil, nil, nil, nil})
		}
		if out == nil {
			out = [][]any{}
		}
		note, estimated := spendInsight(db)
		return map[string]any{
			"dim": dim, "columns": []string{dim, "cost_usd", "share", "requests", "input", "output", "cache_read", "cache_write", "cache_hit"},
			"rows": out, "note": note, "estimated": estimated,
		}, nil
	}
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
		note, estimated := spendInsight(db)
		return map[string]any{
			"dim":       dim,
			"columns":   []string{"tool_name", "calls", "result_tokens", "exec_s", "wait_s"},
			"rows":      out,
			"note":      note,
			"estimated": estimated,
		}, nil
	}
	// source: Claude Code next to each app. App input tokens include cache
	// reads and writes (GenAI convention); Claude Code's do not, so subtract.
	from := "llm WHERE NOT is_error"
	col := ""
	if dim == "source" {
		from = `(SELECT 'Claude Code' AS src, cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens FROM llm WHERE NOT is_error
			UNION ALL
			SELECT service, cost_usd, greatest(coalesce(input_tokens,0) - coalesce(cache_read_tokens,0) - coalesce(cache_write_tokens,0), 0),
				output_tokens, cache_read_tokens, cache_write_tokens FROM calls WHERE NOT is_error AND error_type IS NULL) u`
		col = "src"
	} else {
		dims := map[string]string{
			"model": "model", "effort": "effort", "skill": "skill_name", "subagent": "agent_name",
			"mcp": "mcp_server_name", "repo": "repo", "query_source": "query_source",
		}
		c, ok := dims[dim]
		if !ok {
			return nil, errDim(dim)
		}
		col = c
	}
	var total sql.NullFloat64
	if err := db.QueryRow("SELECT sum(cost_usd) FROM " + from).Scan(&total); err != nil {
		return nil, err
	}
	tot := 1.0
	if total.Valid && total.Float64 != 0 {
		tot = total.Float64
	}
	rows, err := db.Query(`SELECT coalesce(` + col + `, '(none)'), sum(cost_usd), sum(cost_usd)/` + strconvf(tot) + `, count(*),
		sum(input_tokens), sum(output_tokens), sum(cache_read_tokens), sum(cache_creation_tokens),
		sum(cache_read_tokens)/nullif(sum(cache_read_tokens+cache_creation_tokens+input_tokens),0)
		FROM ` + from + ` GROUP BY 1 ORDER BY 2 DESC`)
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
	note, estimated := spendInsight(db)
	return map[string]any{
		"dim":       dim,
		"columns":   []string{dim, "cost_usd", "share", "requests", "input", "output", "cache_read", "cache_write", "cache_hit"},
		"rows":      out,
		"note":      note,
		"estimated": estimated,
	}, nil
}

// spendInsight is one sentence about who drove spend this period.
// History-only stores mark that the dollars are estimated from session files.
func spendInsight(db *sql.DB) (string, bool) {
	estimated := history.Only(db)
	var total sql.NullFloat64
	if err := db.QueryRow(`SELECT sum(cost_usd) FROM model_stats`).Scan(&total); err != nil || !total.Valid || total.Float64 <= 0 {
		if estimated {
			return "No spend this period, estimated from session files.", estimated
		}
		return "No spend this period.", estimated
	}
	tot := total.Float64

	var model string
	var mCost sql.NullFloat64
	_ = db.QueryRow(`SELECT model, cost_usd FROM model_stats ORDER BY cost_usd DESC LIMIT 1`).Scan(&model, &mCost)
	var repo string
	var rCost sql.NullFloat64
	_ = db.QueryRow(`SELECT coalesce(nullif(repo,''),'(none)'), sum(cost_usd) FROM session_stats GROUP BY 1 ORDER BY 2 DESC LIMIT 1`).Scan(&repo, &rCost)

	mShare, rShare := 0.0, 0.0
	if mCost.Valid {
		mShare = mCost.Float64 / tot
	}
	if rCost.Valid {
		rShare = rCost.Float64 / tot
	}

	lead := ""
	if repo != "" && repo != "(none)" && rShare > mShare {
		lead = repo
	} else {
		lead = modelDisplay(model)
		if lead == "" || lead == "the model" {
			lead = model
		}
	}
	if lead == "" || lead == "(none)" {
		if estimated {
			return "No spend this period, estimated from session files.", estimated
		}
		return "No spend this period.", estimated
	}
	msg := lead + " drove most of this period's spend."
	if estimated {
		msg = lead + " drove most of this period's spend, estimated from session files."
	}
	return msg, estimated
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

func cleanTitle(t sql.NullString) any {
	if !t.Valid {
		return nil
	}
	c := cleanPrompt(t.String)
	if c == "" {
		return nil
	}
	if r := []rune(c); len(r) > 200 {
		return string(r[:200])
	}
	return c
}

// traceService is the service.name that sent a trace's root (or any) span.
func traceService(db *sql.DB, tid string) string {
	var svc sql.NullString
	_ = db.QueryRow(`SELECT json_extract_string(resource, '$."service.name"') FROM spans WHERE trace_id=?
		ORDER BY coalesce(parent_span_id, '') = '' DESC, start_ns LIMIT 1`, tid).Scan(&svc)
	return svc.String
}
