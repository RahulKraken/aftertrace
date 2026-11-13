//go:build harness

package main

import (
	"log"
	"os"
	"strings"
	"time"

	"github.com/RahulKraken/aftertrace/internal/store"
)

// AFTERTRACE_REOPEN is compiled only with -tags harness. When that path
// appears, serve calls Store.Reopen once so B6 can force a recycle.
func watchHarnessReopen(st *store.Store, stop <-chan struct{}) {
	path := strings.TrimSpace(os.Getenv("AFTERTRACE_REOPEN"))
	if path == "" {
		return
	}
	tk := time.NewTicker(50 * time.Millisecond)
	defer tk.Stop()
	for {
		select {
		case <-stop:
			return
		case <-tk.C:
			if _, err := os.Stat(path); err != nil {
				continue
			}
			if err := st.Reopen(); err != nil {
				log.Printf("reopen: %v", err)
			} else {
				log.Printf("reopen: harness trigger")
			}
			_ = os.Remove(path)
		}
	}
}
