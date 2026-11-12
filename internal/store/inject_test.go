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
