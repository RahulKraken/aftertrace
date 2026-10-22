package internal_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/RahulKraken/aftertrace/internal/analysis"
	"github.com/RahulKraken/aftertrace/internal/api"
	"github.com/RahulKraken/aftertrace/internal/ask"
	"github.com/RahulKraken/aftertrace/internal/demo"
	"github.com/RahulKraken/aftertrace/internal/otlp"
	"github.com/RahulKraken/aftertrace/internal/query"
	"github.com/RahulKraken/aftertrace/internal/redact"
	"github.com/RahulKraken/aftertrace/internal/rules"
	"github.com/RahulKraken/aftertrace/internal/store"
	"github.com/RahulKraken/aftertrace/web"
	"github.com/anthropics/anthropic-sdk-go/option"
	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	resourcepb "go.opentelemetry.io/proto/otlp/resource/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
)

func loadDemo(t *testing.T) *store.Store {
	t.Helper()
	dir := t.TempDir()
	if _, err := demo.WriteJSONL(dir); err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(filepath.Join(t.TempDir(), "t.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	if _, err := otlp.ImportDir(st, dir, false); err != nil {
		t.Fatal(err)
	}
	c, err := st.Counts()
	if err != nil {
		t.Fatal(err)
	}
	if c.Spans == 0 || c.Events == 0 {
		t.Fatalf("empty ingest: %+v", c)
	}
	return st
}

func TestRulesFireOnIntendedScenariosAndStaySilentOnCleanSession(t *testing.T) {
	st := loadDemo(t)
	fs := rules.RunAll(st.DB)
	got := map[string][]rules.Finding{}
	for _, f := range fs {
		got[f.RuleID] = append(got[f.RuleID], f)
	}
	need := []string{
		"permission.allow_rule_candidate",
		"retry.waste",
		"retry.exhausted",
		"cache.drop_after_compaction",
		"model.switch_cache_rebuild",
		"skill.cost",
		"plugin.skills_unused",
		"tool.repeated_errors",
		"hook.overhead",
		"mcp.large_results",
	}
	for _, id := range need {
		if len(got[id]) == 0 {
			t.Errorf("rule %s did not fire", id)
		}
	}
	var clean string
	err := st.DB.QueryRow(`SELECT session_id FROM llm WHERE model='claude-haiku-5' AND agent_id IS NULL GROUP BY session_id HAVING count(*) >= 1`).Scan(&clean)
	if err != nil {
		t.Fatalf("clean session: %v", err)
	}
	for _, f := range fs {
		if f.Severity == "error" {
			t.Errorf("rule error: %s %s", f.RuleID, f.Headline)
		}
		for _, sid := range f.Sessions {
			if sid == clean {
				t.Errorf("rule %s attached to clean haiku session", f.RuleID)
			}
		}
		for _, e := range f.Evidence {
			var sess string
			_ = st.DB.QueryRow(`SELECT session_id FROM spans WHERE trace_id=? AND span_id=?`, e.TraceID, e.SpanID).Scan(&sess)
			if sess == clean {
				t.Errorf("rule %s evidence on clean session span %s", f.RuleID, e.SpanID)
			}
		}
	}
}

func TestAPIGolden(t *testing.T) {
	st := loadDemo(t)
	srv := httptest.NewServer(api.New(st, web.FS))
	t.Cleanup(srv.Close)

	get := func(path string) []byte {
		t.Helper()
		res, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		if res.StatusCode != 200 {
			t.Fatalf("%s -> %d %s", path, res.StatusCode, b)
		}
		return b
	}
	post := func(path string, body any) []byte {
		t.Helper()
		raw, _ := json.Marshal(body)
		res, err := http.Post(srv.URL+path, "application/json", bytes.NewReader(raw))
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		if res.StatusCode != 200 {
			t.Fatalf("POST %s -> %d %s", path, res.StatusCode, b)
		}
		return b
	}

	var sessions []map[string]any
	if err := json.Unmarshal(get("/api/sessions"), &sessions); err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 6 {
		t.Fatalf("sessions=%d want 6", len(sessions))
	}
	sid := sessions[0]["session_id"].(string)
	var sess map[string]any
	if err := json.Unmarshal(get("/api/session/"+sid), &sess); err != nil {
		t.Fatal(err)
	}
	if sess["session"] == nil {
		t.Fatal("session detail missing session")
	}
	turns := sess["turns"].([]any)
	if len(turns) == 0 {
		t.Fatal("no turns")
	}
	tid := turns[0].(map[string]any)["trace_id"].(string)
	var tr map[string]any
	if err := json.Unmarshal(get("/api/trace/"+tid), &tr); err != nil {
		t.Fatal(err)
	}
	if len(tr["spans"].([]any)) == 0 {
		t.Fatal("trace has no spans")
	}

	var findings []map[string]any
	if err := json.Unmarshal(get("/api/findings"), &findings); err != nil {
		t.Fatal(err)
	}
	if len(findings) < 10 {
		t.Fatalf("findings=%d", len(findings))
	}

	for _, dim := range []string{"model", "effort", "skill", "subagent", "mcp", "tool", "repo", "query_source"} {
		var c map[string]any
		if err := json.Unmarshal(get("/api/cost?dim="+dim), &c); err != nil {
			t.Fatal(err)
		}
		if c["dim"] != dim {
			t.Fatalf("cost dim %s", c["dim"])
		}
		if _, ok := c["rows"].([]any); !ok {
			t.Fatalf("cost %s missing rows", dim)
		}
	}

	var fields []any
	if err := json.Unmarshal(get("/api/fields"), &fields); err != nil {
		t.Fatal(err)
	}
	if len(fields) == 0 {
		t.Fatal("no fields")
	}
	var rng map[string]any
	if err := json.Unmarshal(get("/api/range"), &rng); err != nil {
		t.Fatal(err)
	}
	if rng["lo"] == nil || rng["hi"] == nil {
		t.Fatal("range")
	}

	qbody := query.Builder{
		Agg: "COUNT", Field: "duration_ms",
		Where:   []query.Where{{Field: "name", Op: "=", Value: "claude_code.llm_request"}},
		GroupBy: []string{"model"}, Order: "desc", Limit: 20,
	}
	var qres map[string]any
	if err := json.Unmarshal(post("/api/query", qbody), &qres); err != nil {
		t.Fatal(err)
	}
	if qres["sql"] == nil || qres["table"] == nil {
		t.Fatalf("query %+v", qres)
	}
	var traces []any
	if err := json.Unmarshal(post("/api/query/traces", map[string]any{"query": qbody}), &traces); err != nil {
		t.Fatal(err)
	}
	if len(traces) == 0 {
		t.Fatal("query traces empty")
	}

	var sqlres query.SQLResult
	if err := json.Unmarshal(post("/api/sql", map[string]string{"sql": "SELECT count(*) AS n FROM spans"}), &sqlres); err != nil {
		t.Fatal(err)
	}
	if len(sqlres.Columns) != 1 || sqlres.Columns[0] != "n" || len(sqlres.Rows) != 1 {
		t.Fatalf("sql %+v", sqlres)
	}

	var names []string
	if err := json.Unmarshal(get("/api/field-values?field=name"), &names); err != nil {
		t.Fatal(err)
	}
	if len(names) == 0 || len(names) > 30 || !contains(names, "claude_code.llm_request") {
		t.Fatalf("field-values name %v", names)
	}
	var models []string
	if err := json.Unmarshal(get("/api/field-values?field=model"), &models); err != nil {
		t.Fatal(err)
	}
	if len(models) == 0 {
		t.Fatal("field-values model empty")
	}
	for _, f := range []string{"nope", "name') FROM spans --", "x'||read_text('/etc/hosts')||'"} {
		res, err := http.Get(srv.URL + "/api/field-values?field=" + url.QueryEscape(f))
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 400 {
			t.Fatalf("field-values %q -> %d, want 400", f, res.StatusCode)
		}
	}

	var ask map[string]any
	if err := json.Unmarshal(post("/api/ask", map[string]string{"question": "why"}), &ask); err != nil {
		t.Fatal(err)
	}
	if ask["sql"] != nil {
		t.Fatal("ask stub should not run SQL")
	}

	goldDir := filepath.Join("testdata")
	_ = os.MkdirAll(goldDir, 0o755)
	type snapshot struct {
		SessionCount int      `json:"session_count"`
		RuleIDs      []string `json:"rule_ids"`
		CostModels   int      `json:"cost_models"`
	}
	ids := []string{}
	seen := map[string]bool{}
	for _, f := range findings {
		id := f["rule_id"].(string)
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	var cost map[string]any
	_ = json.Unmarshal(get("/api/cost?dim=model"), &cost)
	snap := snapshot{SessionCount: len(sessions), RuleIDs: ids, CostModels: len(cost["rows"].([]any))}
	got, _ := json.MarshalIndent(snap, "", "  ")
	wantPath := filepath.Join("testdata", "api_golden.json")
	if _, err := os.Stat(wantPath); os.IsNotExist(err) {
		if err := os.WriteFile(wantPath, got, 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("wrote %s", wantPath)
	} else {
		want, err := os.ReadFile(wantPath)
		if err != nil {
			t.Fatal(err)
		}
		if string(want) != string(got)+"\n" && string(want) != string(got) {
			t.Fatalf("golden mismatch\nwant %s\ngot %s", want, got)
		}
	}
}

func TestRedactDropsContentAndEmail(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "r.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	req := &coltracepb.ExportTraceServiceRequest{
		ResourceSpans: []*tracepb.ResourceSpans{{
			Resource: &resourcepb.Resource{Attributes: []*commonpb.KeyValue{
				kv("service.name", "claude-code"),
				kv("user.email", "you@example.com"),
				kv("user.account_id", "user_secret"),
				kv("aftertrace.synthetic", "true"),
			}},
			ScopeSpans: []*tracepb.ScopeSpans{{
				Spans: []*tracepb.Span{{
					TraceId: bytesN(16, 1), SpanId: bytesN(8, 2), Name: "claude_code.interaction",
					StartTimeUnixNano: 1, EndTimeUnixNano: 2,
					Attributes: []*commonpb.KeyValue{
						kv("session.id", "s1"),
						kv("user.id", "hashed-user"),
						kv("organization.id", "org-uuid"),
						kv("process.owner", "someone"),
						kv("user_prompt", "secret prompt"),
						kv("user_prompt_length", int64(12)),
					},
				}},
			}},
		}},
	}
	sp, _ := otlp.ConvertTraces(req, false)
	if err := st.Insert(sp, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	var attrs string
	if err := st.DB.QueryRow(`SELECT attrs::VARCHAR FROM spans`).Scan(&attrs); err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	_ = json.Unmarshal([]byte(attrs), &m)
	if _, ok := m["user_prompt"]; ok {
		t.Fatal("user_prompt stored")
	}
	if _, ok := m["user.email"]; ok {
		t.Fatal("email on span attrs")
	}
	for _, k := range []string{"user.id", "organization.id", "process.owner"} {
		if _, ok := m[k]; ok {
			t.Fatalf("%s on span attrs", k)
		}
	}
	var res string
	if err := st.DB.QueryRow(`SELECT resource::VARCHAR FROM spans`).Scan(&res); err != nil {
		t.Fatal(err)
	}
	var rm map[string]any
	_ = json.Unmarshal([]byte(res), &rm)
	if _, ok := rm["user.email"]; ok {
		t.Fatal("email stored")
	}
	if _, ok := rm["user.account_id"]; ok {
		t.Fatal("account id stored")
	}
	if rm["aftertrace.synthetic"] != "true" {
		t.Fatalf("synthetic flag: %v", rm["aftertrace.synthetic"])
	}
	if m["user_prompt_length"] == nil {
		t.Fatal("dropped length")
	}
}

func TestSQLRejectsWrites(t *testing.T) {
	st := loadDemo(t)
	_, err := query.RunSQL(st.DB, "DELETE FROM spans", 10)
	if err == nil {
		t.Fatal("expected reject")
	}
	_, err = query.RunSQL(st.DB, "SELECT 1; SELECT 2", 10)
	if err == nil {
		t.Fatal("expected reject multi")
	}
}

func TestSQLSandbox(t *testing.T) {
	st := loadDemo(t)
	dir := t.TempDir()
	secret := filepath.Join(dir, "secret.txt")
	if err := os.WriteFile(secret, []byte("a,b\n1,2\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	before, err := st.Counts()
	if err != nil {
		t.Fatal(err)
	}
	q := func(s string) string { return strings.ReplaceAll(s, "SECRET", secret) }

	// Pass the SELECT/WITH regex, so the DuckDB sandbox has to refuse them.
	for _, s := range []string{
		"SELECT * FROM read_text('SECRET')",
		"SELECT * FROM read_csv('SECRET')",
		"SELECT * FROM read_csv_auto('SECRET')",
		"SELECT * FROM 'SECRET'",
		"WITH x AS (SELECT 1) SELECT * FROM read_blob('SECRET')",
		"SELECT * FROM glob('" + dir + "/*')",
		"WITH x AS (SELECT 1) DELETE FROM spans",
		"WITH x AS (SELECT 1) INSERT INTO span_events SELECT * FROM span_events",
	} {
		if res, err := query.RunSQL(st.DB, q(s), 10); err == nil {
			t.Errorf("RunSQL(%q) = %+v, want error", s, res)
		}
	}

	// The regex refuses these. DuckDB must too, on the shared connection, in case the regex is wrong.
	for _, s := range []string{
		"COPY spans TO '" + filepath.Join(dir, "out.csv") + "'",
		"ATTACH '" + filepath.Join(dir, "other.duckdb") + "' AS other",
		"INSTALL httpfs",
		"LOAD httpfs",
		"SET enable_external_access=true",
		"SET lock_configuration=false",
	} {
		if _, err := query.RunSQL(st.DB, s, 10); err == nil {
			t.Errorf("RunSQL(%q) succeeded, want error", s)
		}
		st.Mu.Lock()
		_, err := st.DB.Exec(s)
		st.Mu.Unlock()
		if err == nil {
			t.Errorf("Exec(%q) succeeded, want the instance to refuse it", s)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "out.csv")); err == nil {
		t.Error("COPY wrote a file")
	}

	after, err := st.Counts()
	if err != nil {
		t.Fatal(err)
	}
	if after != before {
		t.Fatalf("counts changed %+v -> %+v", before, after)
	}

	for _, s := range []string{
		"SELECT count(*) FROM q_spans",
		"SELECT model, sum(cost_usd) FROM llm GROUP BY 1",
		"WITH t AS (SELECT tool_name FROM tools) SELECT count(*) FROM t",
		"SELECT a(attrs, 'model') FROM spans LIMIT 1",
	} {
		res, err := query.RunSQL(st.DB, s, 10)
		if err != nil || len(res.Rows) == 0 {
			t.Errorf("RunSQL(%q) = %+v, %v", s, res, err)
		}
	}
}

func contains(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

func kv(k string, v any) *commonpb.KeyValue {
	kv := &commonpb.KeyValue{Key: k, Value: &commonpb.AnyValue{}}
	switch t := v.(type) {
	case string:
		kv.Value.Value = &commonpb.AnyValue_StringValue{StringValue: t}
	case int64:
		kv.Value.Value = &commonpb.AnyValue_IntValue{IntValue: t}
	default:
		kv.Value.Value = &commonpb.AnyValue_StringValue{StringValue: fmt.Sprint(v)}
	}
	return kv
}

func bytesN(n, fill int) []byte {
	b := make([]byte, n)
	for i := range b {
		b[i] = byte(fill)
	}
	return b
}

func TestRedactList(t *testing.T) {
	m := map[string]any{"prompt": "x", "user.email": "a@b", "model": "m"}
	redact.Attrs(m, false)
	if _, ok := m["prompt"]; ok {
		t.Fatal("prompt")
	}
	if _, ok := m["user.email"]; ok {
		t.Fatal("email")
	}
	if m["model"] != "m" {
		t.Fatal("model")
	}
}

// Claude Code 2.1.153 does not put tool_use_id on claude_code.tool spans, and the
// blocked_on_user span says decision=unknown in non-interactive runs. The
// tool_decision event, linked to the wait span by span context, has both.
func TestToolsViewJoinsDecisionEventBySpanContext(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "t.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	spans := []store.Span{
		{TraceID: "t1", SpanID: "tool", ParentSpanID: "turn", Name: "claude_code.tool", StartNS: 1, EndNS: 10,
			SessionID: "s1", Attrs: map[string]any{"tool_name": "Bash", "full_command": "npm test"}},
		{TraceID: "t1", SpanID: "wait", ParentSpanID: "tool", Name: "claude_code.tool.blocked_on_user", StartNS: 1, EndNS: 5,
			SessionID: "s1", Attrs: map[string]any{"decision": "unknown", "source": "unknown"}},
	}
	evs := []store.Event{{TsNS: 5, Name: "tool_decision", SessionID: "s1", TraceID: "t1", SpanID: "wait", ToolUseID: "toolu_1",
		Attrs: map[string]any{"decision": "accept", "source": "user_temporary", "tool_use_id": "toolu_1"}}}
	if err := st.Insert(spans, nil, evs, nil); err != nil {
		t.Fatal(err)
	}
	var tuid, decision, source string
	if err := st.DB.QueryRow(`SELECT tool_use_id, decision, decision_source FROM tools`).Scan(&tuid, &decision, &source); err != nil {
		t.Fatal(err)
	}
	if tuid != "toolu_1" || decision != "accept" || source != "user_temporary" {
		t.Fatalf("tools view: tool_use_id=%q decision=%q source=%q", tuid, decision, source)
	}
}

// A fresh store has no findings. The UI calls .filter on the response, so it
// must be [] and never null.
func TestFindingsEmptyStoreIsEmptyArray(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "e.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	b, err := json.Marshal(rules.RunAll(st.DB))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != "[]" {
		t.Fatalf("findings on empty store: %s", b)
	}
}

// A turn that is still running has no claude_code.interaction span yet. It
// must still show up as a turn, with a stand-in root for the waterfall.
func TestRunningTurnHasStandInRoot(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "run.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	spans := []store.Span{
		{TraceID: "t1", SpanID: "llm", ParentSpanID: "turn", Name: "claude_code.llm_request", StartNS: 100, EndNS: 300,
			SessionID: "s1", Attrs: map[string]any{"session.id": "s1"}},
		{TraceID: "t1", SpanID: "tool", ParentSpanID: "turn", Name: "claude_code.tool", StartNS: 300, EndNS: 500,
			SessionID: "s1", Attrs: map[string]any{"session.id": "s1"}},
		// The child of a tool that is still running arrives before the tool span.
		{TraceID: "t1", SpanID: "exec", ParentSpanID: "running-tool", Name: "claude_code.tool.execution", StartNS: 520, EndNS: 600,
			SessionID: "s1", Attrs: map[string]any{"session.id": "s1"}},
	}
	if err := st.Insert(spans, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	var root string
	var pending bool
	if err := st.DB.QueryRow(`SELECT span_id, in_progress FROM turn_roots WHERE trace_id='t1'`).Scan(&root, &pending); err != nil {
		t.Fatal(err)
	}
	if root != "turn" || !pending {
		t.Fatalf("turn_roots: span_id=%q in_progress=%v", root, pending)
	}
	rows, err := analysis.SpanRows(st.DB, "t1")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 4 || rows[0].SpanID != "turn" || rows[0].Name != "claude_code.interaction" ||
		rows[0].StartNS != 100 || rows[0].EndNS != 600 || rows[0].Attrs[analysis.InProgressAttr] != true ||
		rows[0].Attrs["session.id"] != "s1" {
		t.Fatalf("stand-in root: %+v", rows[0])
	}
	for _, r := range rows[1:] {
		if r.ParentSpanID != "turn" {
			t.Fatalf("%s parent %q, want it under the stand-in root", r.SpanID, r.ParentSpanID)
		}
	}
}

// Ask end to end: a fake Anthropic API asks for one query, then answers
// citing a demo turn. The API runs the SQL in the sandbox and labels evidence.
func TestAskEndToEnd(t *testing.T) {
	st := loadDemo(t)
	var tid string
	if err := st.DB.QueryRow(`SELECT trace_id FROM turn_roots ORDER BY duration_ms DESC LIMIT 1`).Scan(&tid); err != nil {
		t.Fatal(err)
	}
	calls := 0
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("content-type", "application/json")
		var block map[string]any
		if calls == 1 {
			block = map[string]any{"type": "tool_use", "id": "tu1", "name": "run_sql",
				"input": map[string]any{"sql": "SELECT count(*) AS turns FROM turn_roots"}}
		} else {
			block = map[string]any{"type": "tool_use", "id": "tu2", "name": "final_answer",
				"input": map[string]any{"answer": "You ran some turns.", "sql": "SELECT count(*) AS turns FROM turn_roots", "trace_ids": []string{tid, "nope"}}}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": fmt.Sprint("m", calls), "type": "message", "role": "assistant",
			"model": "claude-opus-5-5", "content": []any{block}, "stop_reason": "tool_use", "stop_sequence": nil,
			"usage": map[string]any{"input_tokens": 1, "output_tokens": 1}})
	}))
	t.Cleanup(fake.Close)
	agent, err := ask.New("k", ask.DefaultModel, option.WithBaseURL(fake.URL))
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(api.New(st, web.FS, api.WithAsk(agent)))
	t.Cleanup(srv.Close)

	res, err := http.Post(srv.URL+"/api/ask", "application/json", strings.NewReader(`{"question":"how many turns?"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out struct {
		Answer   string           `json:"answer"`
		Enabled  bool             `json:"enabled"`
		Result   *query.SQLResult `json:"result"`
		Evidence []map[string]any `json:"evidence"`
		Steps    []map[string]any `json:"steps"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if !out.Enabled || out.Answer != "You ran some turns." || len(out.Steps) != 1 {
		t.Fatalf("ask: %+v", out)
	}
	if out.Result == nil || len(out.Result.Rows) != 1 {
		t.Fatalf("result: %+v", out.Result)
	}
	if len(out.Evidence) != 1 || out.Evidence[0]["trace_id"] != tid || out.Evidence[0]["label"] == "" {
		t.Fatalf("evidence: %+v", out.Evidence)
	}

	// Without --ask the endpoint explains how to turn it on and calls nothing.
	off := httptest.NewServer(api.New(st, web.FS))
	t.Cleanup(off.Close)
	r2, err := http.Post(off.URL+"/api/ask", "application/json", strings.NewReader(`{"question":"q"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer r2.Body.Close()
	b, _ := io.ReadAll(r2.Body)
	if !strings.Contains(string(b), `"enabled":false`) || !strings.Contains(string(b), "--ask") {
		t.Fatalf("ask off: %s", b)
	}
}

// Only a person deciding a prompt counts as waiting on you. Config, hook and
// auto-mode decisions are permission checks.
func TestPermissionWaitCountsOnlyHumanDecisions(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "w.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ms := int64(1e6)
	spans := []store.Span{
		{TraceID: "t", SpanID: "turn", Name: "claude_code.interaction", StartNS: 0, EndNS: 100 * ms, Attrs: map[string]any{}},
		{TraceID: "t", SpanID: "a", ParentSpanID: "turn", Name: "claude_code.tool", StartNS: 0, EndNS: 40 * ms, Attrs: map[string]any{}},
		{TraceID: "t", SpanID: "aw", ParentSpanID: "a", Name: "claude_code.tool.blocked_on_user", StartNS: 0, EndNS: 30 * ms,
			Attrs: map[string]any{"source": "unknown"}},
		{TraceID: "t", SpanID: "b", ParentSpanID: "turn", Name: "claude_code.tool", StartNS: 50 * ms, EndNS: 90 * ms, Attrs: map[string]any{}},
		{TraceID: "t", SpanID: "bw", ParentSpanID: "b", Name: "claude_code.tool.blocked_on_user", StartNS: 50 * ms, EndNS: 60 * ms,
			Attrs: map[string]any{"source": "user_temporary"}},
	}
	evs := []store.Event{{TsNS: 30 * ms, Name: "tool_decision", TraceID: "t", SpanID: "aw", Attrs: map[string]any{"source": "config"}}}
	if err := st.Insert(spans, nil, evs, nil); err != nil {
		t.Fatal(err)
	}
	rows, err := analysis.SpanRows(st.DB, "t")
	if err != nil {
		t.Fatal(err)
	}
	bd := analysis.Breakdown(st.DB, "t", rows)
	if bd["permission_wait"] != 10 || bd["permission_check"] != 30 {
		t.Fatalf("breakdown: %v", bd)
	}
}

// Every GET endpoint answers, twice in a row, within a deadline. Catches a
// handler that takes the store lock and calls something that takes it again.
func TestEndpointsDoNotDeadlock(t *testing.T) {
	st := loadDemo(t)
	srv := httptest.NewServer(api.New(st, web.FS))
	t.Cleanup(srv.Close)
	client := &http.Client{Timeout: 20 * time.Second}
	var tid string
	_ = st.DB.QueryRow(`SELECT trace_id FROM turn_roots LIMIT 1`).Scan(&tid)
	var sid string
	_ = st.DB.QueryRow(`SELECT session_id FROM turn_roots WHERE session_id IS NOT NULL LIMIT 1`).Scan(&sid)
	paths := []string{"/api/status", "/api/overview", "/api/sources", "/api/sessions", "/api/session/" + sid, "/api/trace/" + tid,
		"/api/findings", "/api/fields", "/api/cost?dim=model", "/api/range", "/api/ask/suggestions"}
	for round := 0; round < 2; round++ {
		for _, p := range paths {
			res, err := client.Get(srv.URL + p)
			if err != nil {
				t.Fatalf("%s: %v", p, err)
			}
			res.Body.Close()
			if res.StatusCode != 200 {
				t.Fatalf("%s -> %d", p, res.StatusCode)
			}
		}
	}
}
