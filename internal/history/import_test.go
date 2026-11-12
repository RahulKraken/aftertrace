package history

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

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
	if len(files) != 6 {
		t.Fatalf("files=%d want 6 (5 sessions + 1 subagent)", len(files))
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
	if res.Sessions != 5 || res.Turns < 4 || res.Requests < 6 {
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
	if out != 142 { // 80+40+12+10, not the streaming partial 10
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
	if !sum.Found || sum.Sessions != 5 || sum.Days < 5 {
		t.Fatalf("summary %+v", sum)
	}
	if sum.CostUSD <= 0 || sum.Tokens <= 0 {
		t.Fatalf("summary cost/tokens %+v", sum)
	}
	if len(sum.Models) < 2 || len(sum.Projects) != 3 {
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

func TestImportFailureRetries(t *testing.T) {
	dir := writeLargeSession(t, 200)
	files, err := ListTranscripts(dir)
	if err != nil || len(files) != 1 {
		t.Fatalf("transcripts: %d err=%v", len(files), err)
	}
	path := files[0].Path
	sid := files[0].SessionID

	gold := openStore(t)
	if _, err := Import(gold, dir); err != nil {
		t.Fatal(err)
	}
	wantSpans, wantEvents, wantCost := sessionTotals(t, gold, sid)
	if wantSpans <= 256 {
		t.Fatalf("fixture spans=%d, need > 256 so a chunk can commit before the injected failure", wantSpans)
	}

	st := openStore(t)
	st.TestingFailInsertAfterChunks(1)
	_, err = Import(st, dir)
	if err == nil {
		t.Fatal("expected injected insert failure")
	}

	var status string
	qerr := st.DB.QueryRow(`SELECT status FROM history_files WHERE path = ?`, path).Scan(&status)
	if qerr == nil && status == "imported" {
		t.Fatalf("failed import marked imported (status=%s)", status)
	}
	if qerr != nil && qerr != sql.ErrNoRows {
		t.Fatal(qerr)
	}

	var midSpans int
	if err := st.DB.QueryRow(`SELECT count(*) FROM spans WHERE session_id = ?`, sid).Scan(&midSpans); err != nil {
		t.Fatal(err)
	}
	if midSpans == 0 {
		t.Fatal("expected at least one committed chunk before the injected failure")
	}

	st.TestingFailInsertAfterChunks(0)
	res, err := Import(st, dir)
	if err != nil {
		t.Fatal(err)
	}
	if res.Sessions != 1 {
		t.Fatalf("retry import %+v", res)
	}
	if err := st.DB.QueryRow(`SELECT status FROM history_files WHERE path = ?`, path).Scan(&status); err != nil || status != "imported" {
		t.Fatalf("retry status=%q err=%v", status, err)
	}
	gotSpans, gotEvents, gotCost := sessionTotals(t, st, sid)
	if gotSpans != wantSpans || gotEvents != wantEvents || gotCost != wantCost {
		t.Fatalf("retry spans=%d events=%d cost=%v; want spans=%d events=%d cost=%v",
			gotSpans, gotEvents, gotCost, wantSpans, wantEvents, wantCost)
	}
}

func sessionTotals(t *testing.T, st *store.Store, sid string) (spans, events int, cost float64) {
	t.Helper()
	if err := st.DB.QueryRow(`SELECT count(*) FROM spans WHERE session_id = ?`, sid).Scan(&spans); err != nil {
		t.Fatal(err)
	}
	if err := st.DB.QueryRow(`SELECT count(*) FROM events WHERE session_id = ?`, sid).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if err := st.DB.QueryRow(`SELECT coalesce(sum(cost_usd),0) FROM llm_facts WHERE session_id = ?`, sid).Scan(&cost); err != nil {
		t.Fatal(err)
	}
	if spans == 0 {
		t.Fatal("session missing from store")
	}
	return
}

func writeLargeSession(t *testing.T, turns int) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), "projects")
	proj := filepath.Join(root, "-home-user-retry")
	if err := os.MkdirAll(proj, 0o755); err != nil {
		t.Fatal(err)
	}
	sid := "aabbccdd-eeee-4fff-8aaa-bbbbbbbbbbbb"
	var b strings.Builder
	t0 := time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC)
	iso := func(at time.Time) string { return at.UTC().Format("2006-01-02T15:04:05.000Z") }
	for i := 0; i < turns; i++ {
		at := t0.Add(time.Duration(i) * time.Minute)
		pid := fmt.Sprintf("%s-p%d", sid[:8], i)
		fmt.Fprintf(&b, `{"type":"user","uuid":"%s-u%d","timestamp":"%s","sessionId":"%s","cwd":"/home/user/retry","version":"2.1.305","promptId":"%s","message":{"role":"user","content":"turn %d"}}`+"\n",
			sid[:8], i, iso(at), sid, pid, i)
		fmt.Fprintf(&b, `{"type":"assistant","uuid":"%s-a%d","timestamp":"%s","sessionId":"%s","cwd":"/home/user/retry","version":"2.1.305","promptId":"%s","requestId":"req_%s_%d","message":{"id":"msg_%s_%d","role":"assistant","model":"claude-sonnet-4","content":[{"type":"text","text":"ok %d"}],"usage":{"input_tokens":120,"output_tokens":40}}}`+"\n",
			sid[:8], i, iso(at.Add(2*time.Second)), sid, pid, sid[:8], i, sid[:8], i, i)
	}
	if err := os.WriteFile(filepath.Join(proj, sid+".jsonl"), []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
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
