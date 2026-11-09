package store

import (
	"path/filepath"
	"testing"
)

func TestInsertMaintainsSessionAndDayRollups(t *testing.T) {
	st, err := Open(filepath.Join(t.TempDir(), "r.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	now := int64(1_700_000_000_000_000_000)
	spans := []Span{
		{TraceID: "t1", SpanID: "root", Name: "claude_code.interaction", StartNS: now, EndNS: now + 1e9, DurationMS: 1000,
			SessionID: "s1", Attrs: map[string]any{"session.title": "hello", "vcs.repository.name": "aftertrace"},
			Resource: map[string]any{"service.name": "claude-code"}},
		{TraceID: "t1", SpanID: "llm", ParentSpanID: "root", Name: "claude_code.llm_request", StartNS: now, EndNS: now + 5e8, DurationMS: 500,
			SessionID: "s1", Attrs: map[string]any{"model": "claude-opus-4-5", "request_id": "r1", "input_tokens": 10.0, "output_tokens": 5.0},
			Resource: map[string]any{"service.name": "claude-code"}},
	}
	evs := []Event{{
		TsNS: now, Name: "api_request", SessionID: "s1", TraceID: "t1", RequestID: "r1",
		Attrs:    map[string]any{"cost_usd": 0.42},
		Resource: map[string]any{"service.name": "claude-code"},
	}}
	if err := st.Insert(spans, nil, evs, nil); err != nil {
		t.Fatal(err)
	}
	var turns int
	var cost float64
	var title, repo string
	if err := st.DB.QueryRow(`SELECT turns, cost_usd, title, repo FROM session_stats WHERE session_id='s1'`).
		Scan(&turns, &cost, &title, &repo); err != nil {
		t.Fatal(err)
	}
	if turns != 1 || cost < 0.4 || title != "hello" || repo != "aftertrace" {
		t.Fatalf("session_stats turns=%d cost=%v title=%q repo=%q", turns, cost, title, repo)
	}
	var n int
	if err := st.DB.QueryRow(`SELECT count(*) FROM trace_roots WHERE trace_id='t1' AND in_progress=false`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("trace_roots=%d", n)
	}
	if err := st.DB.QueryRow(`SELECT count(*) FROM turn_roots`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("turn_roots view=%d", n)
	}
	var srcSpans int64
	if err := st.DB.QueryRow(`SELECT spans FROM source_stats WHERE name='claude-code'`).Scan(&srcSpans); err != nil {
		t.Fatal(err)
	}
	if srcSpans != 2 {
		t.Fatalf("source spans=%d", srcSpans)
	}
}

func TestCompactContentStripsPromptPayload(t *testing.T) {
	st, err := Open(filepath.Join(t.TempDir(), "c.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Insert([]Span{{
		TraceID: "t", SpanID: "s", Name: "claude_code.interaction", StartNS: 1, EndNS: 2, DurationMS: 1,
		Attrs: map[string]any{"prompt": "SECRET_PROMPT_TEXT", "model": "opus"},
	}}, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	n, err := st.CompactContent()
	if err != nil {
		t.Fatal(err)
	}
	if n == 0 {
		t.Fatal("expected compact to rewrite tables")
	}
	var prompt string
	_ = st.DB.QueryRow(`SELECT coalesce(json_extract_string(attrs, '$."prompt"'), '') FROM spans`).Scan(&prompt)
	if prompt != "" {
		t.Fatalf("prompt still stored: %q", prompt)
	}
	var model string
	_ = st.DB.QueryRow(`SELECT json_extract_string(attrs, '$."model"') FROM spans`).Scan(&model)
	if model != "opus" {
		t.Fatalf("non-content attr lost: %q", model)
	}
}
