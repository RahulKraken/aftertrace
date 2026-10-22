package otlp

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/RahulKraken/aftertrace/internal/store"
	"google.golang.org/protobuf/encoding/protojson"
)

func TestImportDirMissing(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "i.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	_, err = ImportDir(st, filepath.Join(t.TempDir(), "no-such-dir"), false)
	if err == nil {
		t.Fatal("expected error for missing directory")
	}
}

func TestImportDirEmpty(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "i.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	dir := t.TempDir()
	c, err := ImportDir(st, dir, false)
	if err != nil {
		t.Fatal(err)
	}
	if c.Spans != 0 || c.Events != 0 || c.MetricPoints != 0 {
		t.Fatalf("empty dir imported %+v", c)
	}
}

func TestImportDirJSONL(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "i.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	dir := t.TempDir()
	body, err := protojson.Marshal(testReq())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "traces.jsonl"), append(body, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
	c, err := ImportDir(st, dir, false)
	if err != nil {
		t.Fatal(err)
	}
	if c.Spans != 1 {
		t.Fatalf("spans=%d", c.Spans)
	}
}

// OTLP/JSON ids are hex; they must come through unchanged, not base64-decoded.
func TestJSONHexIDsAreKept(t *testing.T) {
	line := []byte(`{"resourceSpans":[{"resource":{},"scopeSpans":[{"spans":[{"traceId":"5b8efff798038103d269b633813fc60c","spanId":"eee19b7ec3c1b174","parentSpanId":"eee19b7ec3c1b173","name":"chat x","startTimeUnixNano":"1","endTimeUnixNano":"2"}]}]}]}`)
	req, err := UnmarshalTracesJSON(line)
	if err != nil {
		t.Fatal(err)
	}
	spans, _ := ConvertTraces(req, false)
	if len(spans) != 1 || spans[0].TraceID != "5b8efff798038103d269b633813fc60c" || spans[0].SpanID != "eee19b7ec3c1b174" || spans[0].ParentSpanID != "eee19b7ec3c1b173" {
		t.Fatalf("ids: %+v", spans)
	}
}
