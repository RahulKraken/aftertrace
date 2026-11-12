package store

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestDSNLocksMemoryAndThreads(t *testing.T) {
	st, err := Open(filepath.Join(t.TempDir(), "t.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	var mem, threads string
	if err := st.DB.QueryRow(`SELECT current_setting('memory_limit')`).Scan(&mem); err != nil {
		t.Fatal(err)
	}
	if err := st.DB.QueryRow(`SELECT current_setting('threads')`).Scan(&threads); err != nil {
		t.Fatal(err)
	}
	// DuckDB treats 256MB as 256e6 bytes (244.1 MiB) or 256 MiB depending on version.
	low := strings.ToLower(mem)
	if !strings.Contains(low, "256") && !strings.Contains(low, "244") {
		t.Fatalf("memory_limit=%q, want ~256MB", mem)
	}
	if threads != "2" {
		t.Fatalf("threads=%q, want 2", threads)
	}
	var order string
	if err := st.DB.QueryRow(`SELECT current_setting('preserve_insertion_order')`).Scan(&order); err != nil {
		t.Fatal(err)
	}
	if order != "false" && order != "False" {
		t.Fatalf("preserve_insertion_order=%q, want false", order)
	}
	if _, err := st.DB.Exec(`SET memory_limit='16GB'`); err == nil {
		t.Fatal("SET memory_limit succeeded; lock_configuration should refuse it")
	}
	if _, err := st.DB.Exec(`SET threads=16`); err == nil {
		t.Fatal("SET threads succeeded; lock_configuration should refuse it")
	}
}
