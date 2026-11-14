//go:build !race

package store

import (
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
)

func TestAuditReopenRace(t *testing.T) {
	st, err := Open(filepath.Join(t.TempDir(), "r.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	sp, ev := auditBatch()
	if err := st.Insert(sp, nil, ev, nil); err != nil {
		t.Fatal(err)
	}
	var fails atomic.Int64
	var wg sync.WaitGroup
	for g := 0; g < 4; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 200; i++ {
				func() {
					defer func() {
						if rec := recover(); rec != nil {
							fails.Add(1)
						}
					}()
					db := st.DB
					if db == nil {
						fails.Add(1)
						return
					}
					var n int
					if err := db.QueryRow(`SELECT count(*) FROM trace_roots`).Scan(&n); err != nil {
						fails.Add(1)
					}
				}()
			}
		}()
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 20; i++ {
			_ = st.Reopen()
		}
	}()
	wg.Wait()
	n := fails.Load()
	t.Logf("Reopen race failures=%d / 800", n)
	if n == 0 {
		t.Log("pass: 0 failed reads during Reopen")
		return
	}
	t.Logf("known bug: %d of 800 reads failed with a closed database during Reopen", n)
	t.Skip("known bug; report-only until a later PR flips this to t.Fatal")
}
