package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInjectedStoreFailure(t *testing.T) {
	trip := filepath.Join(t.TempDir(), "fail")
	if err := os.WriteFile(trip, []byte("1"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("AFTERTRACE_FAIL_STORE", trip)
	st, err := Open(filepath.Join(t.TempDir(), "i.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	sp, ev := auditBatch()
	err = st.Insert(sp, nil, ev, nil)
	if err == nil || !strings.Contains(err.Error(), "injected store failure") {
		t.Fatalf("Insert err=%v", err)
	}
	var n int
	if err := st.DB.QueryRow(`SELECT count(*) FROM spans`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("wrote %d spans under injected failure", n)
	}
}

func TestFailStoreCachedAtOpen(t *testing.T) {
	trip := filepath.Join(t.TempDir(), "fail")
	if err := os.WriteFile(trip, []byte("1"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("AFTERTRACE_FAIL_STORE", trip)
	st, err := Open(filepath.Join(t.TempDir(), "i.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	t.Setenv("AFTERTRACE_FAIL_STORE", "")
	sp, ev := auditBatch()
	if err := st.Insert(sp, nil, ev, nil); err == nil || !strings.Contains(err.Error(), "injected store failure") {
		t.Fatalf("cached path must still trip after env cleared: %v", err)
	}

	st2, err := Open(filepath.Join(t.TempDir(), "j.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	defer st2.Close()
	t.Setenv("AFTERTRACE_FAIL_STORE", trip)
	if err := st2.Insert(sp, nil, ev, nil); err != nil {
		t.Fatalf("unset at Open must not getenv on Insert: %v", err)
	}
}

func TestOpenReadOnlyDoesNotWrite(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "r.duckdb")
	st, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	sp, ev := auditBatch()
	if err := st.Insert(sp, nil, ev, nil); err != nil {
		t.Fatal(err)
	}
	if err := st.Close(); err != nil {
		t.Fatal(err)
	}
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	ro, err := OpenReadOnly(path)
	if err != nil {
		t.Fatal(err)
	}
	var n int
	if err := ro.DB.QueryRow(`SELECT count(*) FROM spans`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n == 0 {
		t.Fatal("expected rows")
	}
	if err := ro.Close(); err != nil {
		t.Fatal(err)
	}
	after, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if after.Size() != before.Size() || !after.ModTime().Equal(before.ModTime()) {
		t.Fatalf("OpenReadOnly wrote: size %d→%d mtime %v→%v", before.Size(), after.Size(), before.ModTime(), after.ModTime())
	}
}
