package history

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/RahulKraken/aftertrace/internal/store"
)

func fixtureDir(t *testing.T) string {
	t.Helper()
	p, err := filepath.Abs("testdata/projects")
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func openStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "t.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func TestListSkipsMemoryAndNonJSONL(t *testing.T) {
	files, err := ListTranscripts(fixtureDir(t))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 4 {
		t.Fatalf("files=%d want 4 (3 sessions + 1 subagent)", len(files))
	}
	for _, f := range files {
		if strings.Contains(f.Path, "memory") || strings.HasSuffix(f.Path, ".txt") {
			t.Fatalf("listed non-transcript %s", f.Path)
		}
	}
}

func TestImportUsageNotContent(t *testing.T) {
	st := openStore(t)
	res, err := Import(st, fixtureDir(t))
	if err != nil {
		t.Fatal(err)
	}
	if res.Sessions != 3 || res.Turns < 4 || res.Requests < 6 {
		t.Fatalf("import %+v", res)
	}

	blob := dumpJSON(t, st)
	for _, secret := range []string{
		"SECRET_PROMPT_ALPHA", "SECRET_REPLY_ALPHA", "SECRET_TOOL_INPUT", "SECRET_TOOL_OUTPUT",
		"SECRET_META_CONTINUE", "SECRET_PROMPT_BETA", "SECRET_SKILL_BODY", "SECRET_TASK_PROMPT",
		"SECRET_SUBAGENT_PROMPT", "SECRET_SUBAGENT_REPLY", "SECRET_IGNORED", "SECRET_PROMPT_GAMMA",
		"SECRET_STRING_RESULT", "SECRET_PATH", "SECRET_REPLY_GAMMA",
	} {
		if strings.Contains(blob, secret) {
			t.Errorf("stored content %q", secret)
		}
	}

	var n int
	if err := st.DB.QueryRow(`SELECT count(*) FROM spans WHERE json_extract_string(resource, '$."aftertrace.source"') = 'history'`).Scan(&n); err != nil || n == 0 {
		t.Fatalf("history spans: %d err=%v", n, err)
	}
	if err := st.DB.QueryRow(`SELECT count(*) FROM llm`).Scan(&n); err != nil || n < 6 {
		t.Fatalf("llm rows=%d err=%v (want >= 6 after streaming dedup)", n, err)
	}
	var out float64
	if err := st.DB.QueryRow(`SELECT sum(output_tokens) FROM llm WHERE session_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'`).Scan(&out); err != nil {
		t.Fatal(err)
	}
	if out != 120 { // 80 + 40, not 10+80+40
		t.Fatalf("session A output tokens = %v, streaming copies were double-counted", out)
	}

	var src, title, tool string
	if err := st.DB.QueryRow(`SELECT a(attrs, 'session.title') FROM spans WHERE name = 'claude_code.interaction' AND session_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' ORDER BY start_ns LIMIT 1`).Scan(&title); err != nil {
		t.Fatal(err)
	}
	if title != "Wire the import path" {
		t.Fatalf("title %q", title)
	}
	if err := st.DB.QueryRow(`SELECT json_extract_string(resource, '$."aftertrace.source"') FROM spans LIMIT 1`).Scan(&src); err != nil || src != store.HistorySource {
		t.Fatalf("source %q", src)
	}
	if err := st.DB.QueryRow(`SELECT a(attrs, 'tool_name') FROM spans WHERE name = 'claude_code.tool' AND a(attrs, 'tool_name') = 'Bash'`).Scan(&tool); err != nil || tool != "Bash" {
		t.Fatalf("bash tool: %q %v", tool, err)
	}

	var compact int
	if err := st.DB.QueryRow(`SELECT count(*) FROM events WHERE name = 'compaction'`).Scan(&compact); err != nil || compact != 1 {
		t.Fatalf("compaction events=%d err=%v", compact, err)
	}
	var sub int
	if err := st.DB.QueryRow(`SELECT count(*) FROM llm WHERE query_source = 'subagent'`).Scan(&sub); err != nil || sub != 1 {
		t.Fatalf("subagent llm=%d err=%v", sub, err)
	}

	sum := Summarize(st.DB, fixtureDir(t))
	if !sum.Found || sum.Sessions != 3 || sum.Days < 5 {
		t.Fatalf("summary %+v", sum)
	}
	if sum.CostUSD <= 0 || sum.Tokens <= 0 {
		t.Fatalf("summary cost/tokens %+v", sum)
	}
	if len(sum.Models) < 2 || len(sum.Projects) != 2 {
		t.Fatalf("models=%v projects=%v", sum.Models, sum.Projects)
	}
}

func TestImportIdempotent(t *testing.T) {
	st := openStore(t)
	dir := fixtureDir(t)
	first, err := Import(st, dir)
	if err != nil {
		t.Fatal(err)
	}
	c1, _ := st.Counts()
	second, err := Import(st, dir)
	if err != nil {
		t.Fatal(err)
	}
	c2, _ := st.Counts()
	if second.Sessions != 0 || second.SkippedUnchanged == 0 {
		t.Fatalf("second import should skip unchanged: %+v", second)
	}
	if c1 != c2 {
		t.Fatalf("counts changed %+v -> %+v", c1, c2)
	}
	_ = first
}

func TestImportDoesNotDoubleCountLiveOTel(t *testing.T) {
	st := openStore(t)
	dir := fixtureDir(t)
	if _, err := Import(st, dir); err != nil {
		t.Fatal(err)
	}
	sid := "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	live := store.Span{
		TraceID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", SpanID: "bbbbbbbbbbbbbbbb",
		Name: "claude_code.llm_request", StartNS: 1, EndNS: 2, DurationMS: 0.001,
		SessionID: sid,
		Attrs:     map[string]any{"session.id": sid, "model": "claude-opus-4-6", "request_id": "live-1"},
		Resource:  map[string]any{"service.name": "claude-code"},
	}
	if err := st.Insert([]store.Span{live}, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	var hist, otel int
	_ = st.DB.QueryRow(`SELECT count(*) FROM spans WHERE session_id = ? AND json_extract_string(resource, '$."aftertrace.source"') = 'history'`, sid).Scan(&hist)
	_ = st.DB.QueryRow(`SELECT count(*) FROM spans WHERE session_id = ? AND coalesce(json_extract_string(resource, '$."aftertrace.source"'), '') <> 'history'`, sid).Scan(&otel)
	if hist != 0 {
		t.Fatalf("history rows left after live OTel: %d", hist)
	}
	if otel != 1 {
		t.Fatalf("live spans=%d", otel)
	}

	again, err := Import(st, dir)
	if err != nil {
		t.Fatal(err)
	}
	if again.SkippedOTel == 0 {
		t.Fatalf("expected skip for live session: %+v", again)
	}
	_ = st.DB.QueryRow(`SELECT count(*) FROM spans WHERE session_id = ? AND json_extract_string(resource, '$."aftertrace.source"') = 'history'`, sid).Scan(&hist)
	if hist != 0 {
		t.Fatalf("re-import wrote history over live OTel: %d", hist)
	}
}

func TestImportMissingDir(t *testing.T) {
	st := openStore(t)
	res, err := Import(st, filepath.Join(t.TempDir(), "nope"))
	if err != nil {
		t.Fatal(err)
	}
	if res.Sessions != 0 {
		t.Fatalf("%+v", res)
	}
}

func TestParseDefensive(t *testing.T) {
	recs, err := ParseFile(filepath.Join(fixtureDir(t), "-home-user-notes", "cccccccc-cccc-4ccc-8ccc-cccccccccccc.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	var types []string
	for _, r := range recs {
		types = append(types, r.Type)
	}
	joined := strings.Join(types, ",")
	if !strings.Contains(joined, "future-event") || !strings.Contains(joined, "user") {
		t.Fatalf("types %v", types)
	}
	for _, r := range recs {
		if r.Type == "assistant" && r.Usage.Output == 0 {
			t.Fatalf("assistant without usage: %+v", r)
		}
	}
}

func dumpJSON(t *testing.T, st *store.Store) string {
	t.Helper()
	rows, err := st.DB.Query(`SELECT coalesce(attrs::VARCHAR, ''), coalesce(resource::VARCHAR, '') FROM spans
		UNION ALL SELECT coalesce(attrs::VARCHAR, ''), coalesce(resource::VARCHAR, '') FROM events`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var b strings.Builder
	for rows.Next() {
		var a, r string
		if err := rows.Scan(&a, &r); err != nil {
			t.Fatal(err)
		}
		b.WriteString(a)
		b.WriteString(r)
	}
	return b.String()
}
