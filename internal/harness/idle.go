//go:build unix

package harness

import (
	"strings"
	"sync/atomic"
	"syscall"
	"time"
)

// Desktop idle with the window hidden (desktop/src/tray.js, engine.js):
// sidecar GET /api/health every 1s, tray glance every 45s (IDLE_MS; hidden
// is 60s), findings cache refresh every 30s. A 20s window never reaches
// glance or findings, which is why B1/B2 require 10 minutes.
const (
	desktopHealthEvery   = time.Second
	desktopGlanceEvery   = 45 * time.Second
	desktopFindingsEvery = 30 * time.Second
)

type idleTraffic struct {
	health, glance, findings atomic.Int64
}

func startDesktopIdle(proc *Proc, stop <-chan struct{}) *idleTraffic {
	tr := &idleTraffic{}
	go func() {
		tk := time.NewTicker(desktopHealthEvery)
		defer tk.Stop()
		for {
			select {
			case <-stop:
				return
			case <-tk.C:
				_, _, _, _ = proc.GET("/api/health")
				tr.health.Add(1)
			}
		}
	}()
	go func() {
		hit := func() {
			_, _, _, _ = proc.GET("/api/health")
			_, _, _, _ = proc.GET("/api/glance")
			tr.glance.Add(1)
		}
		hit()
		tk := time.NewTicker(desktopGlanceEvery)
		defer tk.Stop()
		for {
			select {
			case <-stop:
				return
			case <-tk.C:
				hit()
			}
		}
	}()
	go func() {
		var inflight atomic.Bool
		hit := func() {
			if !inflight.CompareAndSwap(false, true) {
				return
			}
			_, _, _, _ = proc.GET("/api/findings")
			tr.findings.Add(1)
			inflight.Store(false)
		}
		hit()
		tk := time.NewTicker(desktopFindingsEvery)
		defer tk.Stop()
		for {
			select {
			case <-stop:
				return
			case <-tk.C:
				hit()
			}
		}
	}()
	return tr
}

func (p *Proc) WaitWarm(d time.Duration) error {
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		if p.Cmd.Process != nil {
			if err := p.Cmd.Process.Signal(syscall.Signal(0)); err != nil {
				return err
			}
		}
		if ScanLogLines(p.LogPath, func(s string) bool {
			return strings.Contains(s, " spans)")
		}) {
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	return errWarmTimeout{d}
}

type errWarmTimeout struct{ d time.Duration }

func (e errWarmTimeout) Error() string {
	return "warm: timeout after " + e.d.String()
}
