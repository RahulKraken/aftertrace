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

	"github.com/RahulKraken/aftertrace/internal/api"
	"github.com/RahulKraken/aftertrace/internal/demo"
	"github.com/RahulKraken/aftertrace/internal/otlp"
	"github.com/RahulKraken/aftertrace/internal/query"
	"github.com/RahulKraken/aftertrace/internal/redact"
	"github.com/RahulKraken/aftertrace/internal/rules"
	"github.com/RahulKraken/aftertrace/internal/store"
	"github.com/RahulKraken/aftertrace/web"
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
	for _, k := range []string{"user.id", "organization.id"} {
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
