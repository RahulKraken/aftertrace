// Package demo writes synthetic Claude Code OTLP so anyone can try Aftertrace
// without a real session. Every record carries aftertrace.synthetic=true.
package demo

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"time"
)

const (
	AppVersion = "2.1.305"
	Seed       = 7
	BaseNS     = int64(1791948600_000000000) // 2026-10-14 09:00 IST, synthetic
)

var prices = map[string][4]float64{
	"claude-opus-5":   {15.0, 75.0, 1.5, 18.75},
	"claude-sonnet-5": {3.0, 15.0, 0.3, 3.75},
	"claude-haiku-5":  {1.0, 5.0, 0.1, 1.25},
}

func av(v any) map[string]any {
	switch t := v.(type) {
	case bool:
		return map[string]any{"boolValue": t}
	case int:
		return map[string]any{"intValue": fmt.Sprintf("%d", t)}
	case int64:
		return map[string]any{"intValue": fmt.Sprintf("%d", t)}
	case float64:
		return map[string]any{"doubleValue": t}
	case []any:
		vals := make([]any, len(t))
		for i, x := range t {
			vals[i] = av(x)
		}
		return map[string]any{"arrayValue": map[string]any{"values": vals}}
	default:
		return map[string]any{"stringValue": fmt.Sprint(v)}
	}
}

func attrs(d map[string]any) []map[string]any {
	out := make([]map[string]any, 0, len(d))
	for k, v := range d {
		if v == nil {
			continue
		}
		out = append(out, map[string]any{"key": k, "value": av(v)})
	}
	return out
}

func iso(ns int64) string {
	return time.Unix(0, ns).UTC().Format("2006-01-02T15:04:05.000Z")
}

var resource = map[string]any{
	"service.name": "claude-code", "service.version": AppVersion,
	"os.type": "darwin", "os.version": "25.1.0", "host.arch": "arm64",
	"aftertrace.synthetic": "true",
}

type Session struct {
	rng        *rand.Rand
	ID         string
	Repo       string
	Model      string
	Effort     any
	T          int64
	spans      []map[string]any
	logs       []map[string]any
	points     []metric
	seq        int
	iseq       int
	ctx        int
	cacheModel string
	skill      string
	entry      string
	Batches    []batch
}

type batch struct {
	Spans []map[string]any
	Logs  []map[string]any
}

type metric struct {
	name, unit string
	ts         int64
	value      float64
	attrs      map[string]any
	dbl        bool
}

func newSession(rng *rand.Rand, repo, model string, effort any, startNS int64, entry string) *Session {
	if entry == "" {
		entry = "cli"
	}
	return &Session{rng: rng, ID: uid(rng), Repo: repo, Model: model, Effort: effort, T: startNS, ctx: 18000, entry: entry}
}

func (s *Session) hexid(n int) string {
	const h = "0123456789abcdef"
	b := make([]byte, n)
	for i := range b {
		b[i] = h[s.rng.Intn(16)]
	}
	return string(b)
}

func (s *Session) b62(n int) string {
	const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = a[s.rng.Intn(len(a))]
	}
	return string(b)
}

func uid(rng *rand.Rand) string {
	var b [16]byte
	for i := range b {
		b[i] = byte(rng.Intn(256))
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

func (s *Session) std() map[string]any {
	return map[string]any{
		"session.id": s.ID, "app.version": AppVersion, "app.entrypoint": s.entry,
		"user.id": "synthetic-user-0001", "terminal.type": "iTerm.app",
		"vcs.repository.url.full": "https://github.com/example-org/" + s.Repo,
		"vcs.owner.name":          "example-org", "vcs.repository.name": s.Repo, "vcs.provider.name": "github",
	}
}

func (s *Session) event(name string, ts int64, a map[string]any, trace, span, promptID string) {
	d := s.std()
	d["event.name"] = name
	d["event.timestamp"] = iso(ts)
	d["event.sequence"] = s.seq
	if promptID != "" {
		d["prompt.id"] = promptID
	}
	for k, v := range a {
		if v != nil {
			d[k] = v
		}
	}
	s.seq++
	rec := map[string]any{
		"timeUnixNano":         fmt.Sprintf("%d", ts),
		"observedTimeUnixNano": fmt.Sprintf("%d", ts+2_000_000),
		"body":                 map[string]any{"stringValue": "claude_code." + name},
		"attributes":           attrs(d),
	}
	if trace != "" {
		rec["traceId"] = trace
		rec["spanId"] = span
	}
	s.logs = append(s.logs, rec)
}

func (s *Session) rawSpan(name, trace, parent string, start, end int64, a map[string]any, sid string, error bool) string {
	if sid == "" {
		sid = s.hexid(16)
	}
	d := s.std()
	d["span.type"] = name
	for k, v := range a {
		if v != nil {
			d[k] = v
		}
	}
	st := map[string]any{}
	if error {
		msg := ""
		if e, ok := a["error"]; ok {
			msg = fmt.Sprint(e)
		}
		st = map[string]any{"code": 2, "message": msg}
	}
	sp := map[string]any{
		"traceId": trace, "spanId": sid, "parentSpanId": parent, "name": name, "kind": 1,
		"startTimeUnixNano": fmt.Sprintf("%d", start), "endTimeUnixNano": fmt.Sprintf("%d", end),
		"attributes": attrs(d), "status": st,
	}
	s.spans = append(s.spans, sp)
	return sid
}

func (s *Session) metric(name, unit string, ts int64, value float64, a map[string]any, dbl bool) {
	d := s.std()
	for k, v := range a {
		d[k] = v
	}
	s.points = append(s.points, metric{name, unit, ts, value, d, dbl})
}

type llmOpt struct {
	model, effort                                          any
	outTokens                                              int
	stop, agent, parentAgent, querySourceSafe, querySource string
	attempts                                               int
	errClass                                               string
	added                                                  *int
	attribution                                            map[string]any
	ttft                                                   int
	fail                                                   bool
	statusCode                                             int
}

func (s *Session) llm(ctx [4]string, start int64, opt llmOpt) (int64, string, float64) {
	model := s.Model
	if m, ok := opt.model.(string); ok && m != "" {
		model = m
	}
	effort := s.Effort
	if opt.effort != "__s" {
		effort = opt.effort
	}
	added := 0
	if opt.added != nil {
		added = *opt.added
	} else {
		added = 900 + s.rng.Intn(3601)
	}
	outTokens := opt.outTokens
	if outTokens == 0 {
		outTokens = 150 + s.rng.Intn(1251)
	}
	var cacheRead, cacheCreate int
	if s.cacheModel == model && opt.agent == "" {
		cacheRead, cacheCreate = s.ctx, added
	} else if opt.agent == "" {
		cacheRead, cacheCreate = 0, s.ctx+added
	} else if added > 8000 {
		cacheRead, cacheCreate = 0, added
	} else {
		cacheRead, cacheCreate = 9000, added
	}
	inputTokens := 3 + s.rng.Intn(38)
	if opt.agent == "" {
		s.ctx += added + outTokens
		s.cacheModel = model
	}
	ttft := opt.ttft
	if ttft == 0 {
		mult := 1.0
		if model == "claude-opus-5" {
			mult = 1.6
		}
		em := map[string]float64{"low": 0.7, "medium": 1, "high": 1.3, "xhigh": 1.8, "max": 2.4}
		eStr, _ := effort.(string)
		if eStr == "" {
			eStr = "medium"
		}
		emult := em[eStr]
		if emult == 0 {
			emult = 1
		}
		ttft = int((900 + s.rng.Float64()*1700) * mult * emult)
	}
	streamMS := int(float64(outTokens) / (55 + s.rng.Float64()*35) * 1000)
	attempts := opt.attempts
	if attempts == 0 {
		attempts = 1
	}
	t := start
	waste := 0
	crIDs := make([]string, attempts)
	var events []map[string]any
	for i := 0; i < attempts; i++ {
		crIDs[i] = uid(s.rng)
		events = append(events, map[string]any{
			"timeUnixNano": fmt.Sprintf("%d", t),
			"name":         "gen_ai.request.attempt",
			"attributes":   attrs(map[string]any{"attempt": i + 1, "client_request_id": crIDs[i]}),
		})
		if i < attempts-1 {
			var failMS int
			if opt.errClass == "api_timeout" {
				failMS = 4000 + s.rng.Intn(8001)
			} else {
				failMS = 600 + s.rng.Intn(901)
			}
			backoff := int(float64(min(32000, 500*(1<<uint(i)))) * (0.8 + s.rng.Float64()*0.4))
			t += int64(failMS+backoff) * 1_000_000
			waste += failMS + backoff
		}
	}
	dur := waste
	if !opt.fail {
		dur += ttft + streamMS
	}
	end := start + int64(dur)*1_000_000
	rid := "req_011" + s.b62(20)
	qss := opt.querySourceSafe
	if qss == "" {
		qss = "repl_main_thread"
	}
	qs := opt.querySource
	if qs == "" {
		qs = "repl_main_thread"
	}
	stop := opt.stop
	if stop == "" {
		stop = "tool_use"
	}
	a := map[string]any{
		"model": model, "gen_ai.system": "anthropic", "gen_ai.request.model": model,
		"query_source_safe": qss, "speed": "normal", "llm_request.context": "interaction",
		"duration_ms": dur, "attempt": attempts, "client_request_id": crIDs[attempts-1],
	}
	if effort != nil {
		a["effort"] = effort
	}
	if opt.agent != "" {
		a["agent_id"] = opt.agent
		a["llm_request.context"] = "tool"
	}
	if opt.parentAgent != "" {
		a["parent_agent_id"] = opt.parentAgent
	}
	if opt.fail {
		sc := opt.statusCode
		if sc == 0 {
			sc = 529
		}
		ec := opt.errClass
		if ec == "" {
			ec = "server_overload"
		}
		a["success"] = false
		a["status_code"] = sc
		a["error"] = "Overloaded"
		a["error_class"] = ec
	} else {
		a["ttft_ms"] = ttft
		a["first_content_ms"] = ttft + 5 + s.rng.Intn(56)
		a["input_tokens"] = inputTokens
		a["output_tokens"] = outTokens
		a["cache_read_tokens"] = cacheRead
		a["cache_creation_tokens"] = cacheCreate
		a["request_id"] = rid
		a["gen_ai.response.id"] = rid
		a["success"] = true
		a["response.has_tool_call"] = stop == "tool_use"
		a["stop_reason"] = stop
		a["gen_ai.response.finish_reasons"] = []any{stop}
	}
	sid := s.rawSpan("claude_code.llm_request", ctx[0], ctx[1], start, end, a, "", opt.fail)
	s.spans[len(s.spans)-1]["events"] = events
	attr := map[string]any{}
	for k, v := range opt.attribution {
		attr[k] = v
	}
	if s.skill != "" {
		if _, ok := attr["skill.name"]; !ok {
			attr["skill.name"] = s.skill
		}
	}
	if opt.fail {
		sc := opt.statusCode
		if sc == 0 {
			sc = 529
		}
		ea := map[string]any{"model": model, "error": "Overloaded", "status_code": sc, "duration_ms": dur,
			"attempt": attempts, "client_request_id": crIDs[attempts-1], "speed": "normal",
			"query_source": qs}
		if effort != nil {
			ea["effort"] = effort
		}
		for k, v := range attr {
			ea[k] = v
		}
		s.event("api_error", end, ea, ctx[0], ctx[3], ctx[2])
		if attempts > 1 {
			s.event("api_retries_exhausted", end, map[string]any{"model": model, "error": "Overloaded", "status_code": sc,
				"total_attempts": attempts, "total_retry_duration_ms": dur, "speed": "normal"}, ctx[0], ctx[3], ctx[2])
		}
		return end, sid, 0
	}
	p := prices[model]
	cost := (float64(inputTokens)*p[0] + float64(outTokens)*p[1] + float64(cacheRead)*p[2] + float64(cacheCreate)*p[3]) / 1e6
	ea := map[string]any{"model": model, "cost_usd": round6(cost), "cost_usd_micros": int(cost * 1e6),
		"duration_ms": dur, "input_tokens": inputTokens, "output_tokens": outTokens,
		"cache_read_tokens": cacheRead, "cache_creation_tokens": cacheCreate, "request_id": rid,
		"client_request_id": crIDs[attempts-1], "speed": "normal", "query_source": qs}
	if effort != nil {
		ea["effort"] = effort
	}
	for k, v := range attr {
		ea[k] = v
	}
	s.event("api_request", end, ea, ctx[0], ctx[3], ctx[2])
	if stop != "tool_use" {
		s.event("assistant_response", end, map[string]any{"response_length": outTokens * 4, "response": "<REDACTED>",
			"model": model, "request_id": rid, "message.uuid": uid(s.rng), "query_source": qs}, ctx[0], ctx[3], ctx[2])
	}
	mqs := "main"
	if opt.agent != "" {
		mqs = "subagent"
	} else if qs == "compact" {
		mqs = "auxiliary"
	}
	ma := map[string]any{"model": model, "query_source": mqs}
	if effort != nil {
		ma["effort"] = effort
	}
	for k, v := range attr {
		ma[k] = v
	}
	s.metric("claude_code.cost.usage", "USD", end, cost, ma, true)
	for typ, v := range map[string]int{"input": inputTokens, "output": outTokens, "cacheRead": cacheRead, "cacheCreation": cacheCreate} {
		aa := map[string]any{}
		for k, x := range ma {
			aa[k] = x
		}
		aa["type"] = typ
		s.metric("claude_code.token.usage", "tokens", end, float64(v), aa, false)
	}
	return end, sid, cost
}

type toolOpt struct {
	execMS, resultTokens               int
	perm                               *perm
	agent, parentAgent, decisionSource string
	extra, params                      map[string]any
	fail, mcp                          string
	children                           func(toolSID string, t int64) int64
}

type perm struct {
	waitMS   int
	decision string
	source   string
}

func (s *Session) tool(ctx [4]string, start int64, name string, opt toolOpt) (int64, string, string) {
	tuid := "toolu_01" + s.b62(22)
	toolSID := s.hexid(16)
	t := start
	a := map[string]any{
		"tool_name": name, "tool_use_id": tuid, "gen_ai.tool.call.id": tuid,
		"result_tokens": opt.resultTokens,
	}
	if opt.resultTokens == 0 {
		a["result_tokens"] = 80 + s.rng.Intn(2421)
	}
	if opt.agent != "" {
		a["agent_id"] = opt.agent
	}
	if opt.parentAgent != "" {
		a["parent_agent_id"] = opt.parentAgent
	}
	if len(name) >= 5 && name[:5] == "mcp__" {
		a["tool_name_safe"] = "mcp_other"
	} else {
		a["tool_name_safe"] = name
	}
	for k, v := range opt.extra {
		a[k] = v
	}
	evname := name
	if len(name) >= 5 && name[:5] == "mcp__" {
		evname = "mcp_tool"
	}
	ds := opt.decisionSource
	if ds == "" {
		ds = "config"
	}
	if opt.perm != nil {
		wait, decision, src := opt.perm.waitMS, opt.perm.decision, opt.perm.source
		s.rawSpan("claude_code.tool.blocked_on_user", ctx[0], toolSID, t, t+int64(wait)*1_000_000,
			map[string]any{"duration_ms": wait, "decision": decision, "source": src}, "", false)
		td := map[string]any{"tool_name": evname, "tool_use_id": tuid, "decision": decision,
			"tool_source": "builtin", "source": src, "permission_mode": "default"}
		if opt.mcp != "" {
			td["tool_source"] = "mcp"
		}
		if opt.params != nil {
			b, _ := json.Marshal(opt.params)
			td["tool_parameters"] = string(b)
		}
		s.event("tool_decision", t+int64(wait)*1_000_000, td, ctx[0], ctx[3], ctx[2])
		t += int64(wait) * 1_000_000
		ds = src
		if decision == "reject" {
			end := t
			s.rawSpan("claude_code.tool", ctx[0], ctx[1], start, end, merge(a, map[string]any{"duration_ms": wait}), toolSID, false)
			return end, toolSID, tuid
		}
	} else {
		td := map[string]any{"tool_name": evname, "tool_use_id": tuid, "decision": "accept",
			"tool_source": "builtin", "source": "config", "permission_mode": "default"}
		if opt.mcp != "" {
			td["tool_source"] = "mcp"
		}
		if opt.params != nil {
			b, _ := json.Marshal(opt.params)
			td["tool_parameters"] = string(b)
		}
		s.event("tool_decision", t, td, ctx[0], ctx[3], ctx[2])
	}
	execEnd := t + int64(opt.execMS)*1_000_000
	if opt.children != nil {
		if c := opt.children(toolSID, t); c > execEnd {
			execEnd = c
		}
	}
	ea := map[string]any{"duration_ms": (execEnd - t) / 1_000_000, "tool_use_id": tuid, "gen_ai.tool.call.id": tuid, "success": opt.fail == ""}
	if opt.fail != "" {
		ea["error"] = opt.fail
		ea["error_class"] = replaceColon(opt.fail)
	}
	s.rawSpan("claude_code.tool.execution", ctx[0], toolSID, t, execEnd, ea, "", opt.fail != "")
	s.rawSpan("claude_code.tool", ctx[0], ctx[1], start, execEnd, merge(a, map[string]any{"duration_ms": (execEnd - start) / 1_000_000}), toolSID, false)
	tr := map[string]any{"tool_name": evname, "tool_use_id": tuid, "success": boolStr(opt.fail == ""),
		"duration_ms": (execEnd - t) / 1_000_000, "decision_type": "accept", "decision_source": ds,
		"tool_input_size_bytes":  60 + s.rng.Intn(841),
		"tool_result_size_bytes": asInt(a["result_tokens"]) * 4}
	if opt.fail != "" {
		tr["success"] = "false"
		tr["error_type"] = opt.fail
	} else {
		tr["success"] = "true"
	}
	if opt.mcp != "" {
		tr["mcp_server_scope"] = opt.mcp
	}
	if opt.params != nil {
		b, _ := json.Marshal(opt.params)
		tr["tool_parameters"] = string(b)
	}
	s.event("tool_result", execEnd, tr, ctx[0], ctx[3], ctx[2])
	return execEnd, toolSID, tuid
}

func (s *Session) interaction(body func(ctx [4]string, t int64) int64, promptLen int, gapS *float64) int64 {
	gap := 20 + s.rng.Float64()*220
	if gapS != nil {
		gap = *gapS
	}
	s.T += int64(gap * 1e9)
	trace := s.hexid(32)
	root := s.hexid(16)
	promptID := uid(s.rng)
	start := s.T
	s.iseq++
	pl := promptLen
	if pl == 0 {
		pl = 40 + s.rng.Intn(561)
	}
	s.event("user_prompt", start, map[string]any{"prompt_length": pl, "prompt": "<REDACTED>", "message.uuid": uid(s.rng)}, trace, root, promptID)
	ctx := [4]string{trace, root, promptID, root}
	end := body(ctx, start+15_000_000)
	end += 10_000_000
	s.rawSpan("claude_code.interaction", trace, "", start, end, map[string]any{
		"user_prompt": "<REDACTED>", "user_prompt_length": max(promptLen, 120),
		"interaction.sequence": s.iseq, "parent.source": "none",
		"interaction.duration_ms": (end - start) / 1_000_000,
	}, root, false)
	s.T = end
	s.metric("claude_code.active_time.total", "s", end, float64(end-start)/1e9, map[string]any{"type": "cli"}, true)
	s.Batches = append(s.Batches, batch{s.spans, s.logs})
	s.spans, s.logs = nil, nil
	return end
}

func (s *Session) start(plugins [][2]any, mcps [][2]string, hooks []string) {
	t := s.T
	s.metric("claude_code.session.count", "", t, 1, map[string]any{"start_type": "fresh"}, false)
	for _, p := range plugins {
		s.event("plugin_loaded", t, map[string]any{"plugin.name": p[0], "marketplace.name": "example-marketplace",
			"plugin.version": "1.0.0", "plugin.scope": "community", "enabled_via": "user-install",
			"plugin_id_hash": s.hexid(16), "has_hooks": false, "has_mcp": false, "host_owned_mcp": false,
			"skill_path_count": p[1], "command_path_count": 0, "agent_path_count": 0, "safe_mode": "false"}, "", "", "")
	}
	for _, m := range mcps {
		ev := map[string]any{"status": m[1], "transport_type": "stdio", "server_scope": "user",
			"duration_ms": 200 + s.rng.Intn(1601), "is_plugin": false, "server_name": m[0]}
		if m[1] == "failed" {
			ev["error_code"] = "ECONNREFUSED"
		}
		s.event("mcp_server_connection", t+300_000_000, ev, "", "", "")
	}
	for _, h := range hooks {
		s.event("hook_registered", t, map[string]any{"hook_event": h, "hook_type": "command", "hook_source": "userSettings", "safe_mode": "false"}, "", "", "")
	}
	s.Batches = append(s.Batches, batch{nil, s.logs})
	s.logs = nil
}

func (s *Session) hook(ctx [4]string, t int64, name string, ms int) int64 {
	ev := name
	if i := indexByte(name, ':'); i >= 0 {
		ev = name[:i]
	}
	s.event("hook_execution_start", t, map[string]any{"hook_event": ev, "hook_name": name, "num_hooks": 1,
		"managed_only": "false", "hook_source": "merged", "safe_mode": "false"}, ctx[0], ctx[3], ctx[2])
	s.event("hook_execution_complete", t+int64(ms)*1_000_000, map[string]any{"hook_event": ev, "hook_name": name,
		"num_hooks": 1, "num_success": 1, "num_blocking": 0, "num_non_blocking_error": 0, "num_cancelled": 0,
		"total_duration_ms": ms, "managed_only": "false", "hook_source": "merged", "safe_mode": "false"}, ctx[0], ctx[3], ctx[2])
	return t + int64(ms)*1_000_000
}

func WriteJSONL(dir string) ([]*Session, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	rng := rand.New(rand.NewSource(Seed))
	sessions := buildSessions(rng)
	addOutputMetrics(sessions, rand.New(rand.NewSource(Seed+1)))
	ft, err := os.Create(filepath.Join(dir, "traces.jsonl"))
	if err != nil {
		return nil, err
	}
	defer ft.Close()
	fl, err := os.Create(filepath.Join(dir, "logs.jsonl"))
	if err != nil {
		return nil, err
	}
	defer fl.Close()
	fm, err := os.Create(filepath.Join(dir, "metrics.jsonl"))
	if err != nil {
		return nil, err
	}
	defer fm.Close()
	res := map[string]any{"attributes": attrs(resource)}
	enc := func(f *os.File, v any) error {
		b, err := json.Marshal(v)
		if err != nil {
			return err
		}
		_, err = f.Write(append(b, '\n'))
		return err
	}
	for _, sess := range sessions {
		for _, b := range sess.Batches {
			if len(b.Spans) > 0 {
				if err := enc(ft, map[string]any{"resourceSpans": []any{map[string]any{
					"resource": res,
					"scopeSpans": []any{map[string]any{
						"scope": map[string]any{"name": "com.anthropic.claude_code.tracing", "version": AppVersion},
						"spans": b.Spans,
					}},
				}}}); err != nil {
					return nil, err
				}
			}
			if len(b.Logs) > 0 {
				if err := enc(fl, map[string]any{"resourceLogs": []any{map[string]any{
					"resource": res,
					"scopeLogs": []any{map[string]any{
						"scope":      map[string]any{"name": "com.anthropic.claude_code.events", "version": AppVersion},
						"logRecords": b.Logs,
					}},
				}}}); err != nil {
					return nil, err
				}
			}
		}
		metrics := map[[2]string][]any{}
		for _, p := range sess.points {
			dp := map[string]any{
				"attributes":        attrs(p.attrs),
				"startTimeUnixNano": fmt.Sprintf("%d", p.ts-60_000_000_000),
				"timeUnixNano":      fmt.Sprintf("%d", p.ts),
			}
			if p.dbl {
				dp["asDouble"] = p.value
			} else {
				dp["asInt"] = fmt.Sprintf("%d", int(p.value))
			}
			k := [2]string{p.name, p.unit}
			metrics[k] = append(metrics[k], dp)
		}
		var ms []any
		for k, dps := range metrics {
			ms = append(ms, map[string]any{
				"name": k[0], "unit": k[1],
				"sum": map[string]any{"dataPoints": dps, "aggregationTemporality": 1, "isMonotonic": true},
			})
		}
		if err := enc(fm, map[string]any{"resourceMetrics": []any{map[string]any{
			"resource": res,
			"scopeMetrics": []any{map[string]any{
				"scope":   map[string]any{"name": "com.anthropic.claude_code", "version": AppVersion},
				"metrics": ms,
			}},
		}}}); err != nil {
			return nil, err
		}
	}
	for _, a := range buildApps(Seed + 2) {
		if err := enc(ft, a.otlp()); err != nil {
			return nil, err
		}
	}
	return sessions, nil
}

func merge(a, b map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		out[k] = v
	}
	return out
}

func round6(v float64) float64 { return float64(int(v*1e6+0.5)) / 1e6 }
func asInt(v any) int {
	switch t := v.(type) {
	case int:
		return t
	case int64:
		return int(t)
	case float64:
		return int(t)
	default:
		return 0
	}
}
func boolStr(ok bool) string {
	if ok {
		return "true"
	}
	return "false"
}
func replaceColon(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c == ':' {
			b[i] = '_'
		}
	}
	return string(b)
}
func indexByte(s string, c byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == c {
			return i
		}
	}
	return -1
}
func ptr[T any](v T) *T { return &v }
