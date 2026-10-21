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
