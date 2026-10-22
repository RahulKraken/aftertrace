package ask

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/RahulKraken/aftertrace/internal/query"
	"github.com/anthropics/anthropic-sdk-go/option"
)

func msg(id, stop string, content ...map[string]any) map[string]any {
	return map[string]any{
		"id": id, "type": "message", "role": "assistant", "model": "claude-opus-5-5",
		"content": content, "stop_reason": stop, "stop_sequence": nil,
		"usage": map[string]any{"input_tokens": 10, "output_tokens": 5},
	}
}

func toolUse(id, name string, input map[string]any) map[string]any {
	return map[string]any{"type": "tool_use", "id": id, "name": name, "input": input}
}

// A fake Messages API: the first call asks for SQL, the second answers.
func TestAskRunsSQLThenAnswers(t *testing.T) {
	var bodies []map[string]any
	var betas []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Errorf("path %s", r.URL.Path)
		}
		betas = append(betas, r.Header.Get("anthropic-beta"))
		b, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(b, &body)
		bodies = append(bodies, body)
		w.Header().Set("content-type", "application/json")
		if len(bodies) == 1 {
			_ = json.NewEncoder(w).Encode(msg("m1", "tool_use",
				toolUse("tu1", "run_sql", map[string]any{"sql": "SELECT model, sum(cost_usd) c FROM llm GROUP BY 1"})))
			return
		}
		_ = json.NewEncoder(w).Encode(msg("m2", "tool_use",
			toolUse("tu2", "final_answer", map[string]any{
				"answer": "Opus cost $3.00.", "sql": "SELECT model, sum(cost_usd) c FROM llm GROUP BY 1", "trace_ids": []string{"t1"},
			})))
	}))
	defer srv.Close()

	a, err := New("test-key", DefaultModel, option.WithBaseURL(srv.URL))
	if err != nil {
		t.Fatal(err)
	}
	long := strings.Repeat("secret prompt text ", 50)
	var ran []string
	run := func(sql string) (*query.SQLResult, error) {
		ran = append(ran, sql)
		return &query.SQLResult{Columns: []string{"model", "c", "note"}, Rows: [][]any{{"claude-opus-5-5", 3.0, long}}}, nil
	}
	res, err := a.Ask(context.Background(), "what did opus cost?", "llm(model, cost_usd)", run)
	if err != nil {
		t.Fatal(err)
	}
	if res.Answer != "Opus cost $3.00." || len(res.TraceIDs) != 1 || res.TraceIDs[0] != "t1" {
		t.Fatalf("result: %+v", res)
	}
	if len(res.Steps) != 1 || res.Steps[0].Rows != 1 || len(ran) != 2 {
		t.Fatalf("steps %+v, ran %d queries", res.Steps, len(ran))
	}
	if res.Result == nil || len(res.Result.Rows) != 1 {
		t.Fatalf("final result not re-run: %+v", res.Result)
	}
	if len(bodies) != 2 {
		t.Fatalf("%d API calls", len(bodies))
	}
	if bodies[0]["model"] != DefaultModel || bodies[0]["fallbacks"] != "default" {
		t.Fatalf("request: model=%v fallbacks=%v", bodies[0]["model"], bodies[0]["fallbacks"])
	}
	if !strings.Contains(betas[0], "server-side-fallback-2026-07-01") {
		t.Fatalf("beta header %q", betas[0])
	}
	// The second request carries the tool result. Long strings must be cut.
	second, _ := json.Marshal(bodies[1]["messages"])
	if strings.Contains(string(second), long) || !strings.Contains(string(second), "[truncated]") {
		t.Fatalf("long cell sent to the model untruncated: %s", second)
	}
}

func TestAskSQLErrorGoesBackToModel(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("content-type", "application/json")
		b, _ := io.ReadAll(r.Body)
		if calls == 1 {
			_ = json.NewEncoder(w).Encode(msg("m1", "tool_use", toolUse("tu1", "run_sql", map[string]any{"sql": "SELECT nope"})))
			return
		}
		if !strings.Contains(string(b), `"is_error":true`) {
			t.Errorf("SQL error not returned as a tool error: %s", b)
		}
		_ = json.NewEncoder(w).Encode(msg("m2", "end_turn", map[string]any{"type": "text", "text": "There is no such column."}))
	}))
	defer srv.Close()
	a, _ := New("k", DefaultModel, option.WithBaseURL(srv.URL))
	res, err := a.Ask(context.Background(), "q", "", func(string) (*query.SQLResult, error) {
		return nil, io.ErrUnexpectedEOF
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Answer != "There is no such column." || len(res.Steps) != 1 || res.Steps[0].Error == "" {
		t.Fatalf("result: %+v", res)
	}
}
