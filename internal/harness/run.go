//go:build unix

package harness

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/RahulKraken/aftertrace/internal/store"
)

var getEndpoints = []string{
	"/api/health",
	"/api/version",
	"/api/status",
	"/api/glance",
	"/api/overview",
	"/api/recap",
	"/api/sources",
	"/api/apps",
	"/api/sessions",
	"/api/findings",
	"/api/fields",
	"/api/field-values",
	"/api/cost",
	"/api/range",
	"/api/ask/suggestions",
}

type tableFP struct {
	Spans, Events, SpanEvents, Metrics int
	HistImported                       int
	ImportedAtMax                      int64
	LLMCost, TraceCost, SessionCost    float64
	DayCost, ModelCost                 float64
	SessionHash                        string
	ImportedWithoutRows                int
}

func Run(t *testing.T, p Profile, bin, work string) (*Report, error) {
	t.Helper()
	rep := newReport(p)
	start := time.Now()
	defer func() { rep.ElapsedMS = time.Since(start).Milliseconds() }()
	rep.Notes = append(rep.Notes,
		"Report-only: a miss does not fail CI.",
		"B1 Electron main CPU is not measured in this job (TODO: packaged desktop on a self-hosted Mac).",
		"DSN memory_limit=256MB (244 MiB), unchanged from shipped engine.",
		"B1 gate is WINDOW CLOSED: supervisor /api/health 1s, tray health+glance 60s. Findings are a side effect, not a poll.",
	)
	if p.SmallCorpus() {
		rep.Notes = append(rep.Notes, "Corpus smaller than 2 GiB: B3/B4/B5/B8 passes are not representative of a 735 MB field DB / 7.9 GB ~/.claude/projects / 244 MiB DuckDB cap.")
	}
	if p.ShortIdle() {
		rep.Notes = append(rep.Notes, "Idle window shorter than 10 minutes: B1/B2 cannot catch the 60s hidden-tray glance.")
	}

	needHist := wantAny("B1", "B2", "B3", "B4", "B5", "B6", "B8", "B10")
	histDir := filepath.Join(work, "projects")
	goldenDB := filepath.Join(work, "golden.duckdb")
	var goldenFP tableFP
	var importDur time.Duration
	importOK := false
	if needHist {
		t.Logf("generating history %s", p.CorpusNote())
		gr, err := GenerateHistory(histDir, GenOpts{Size: p.Size, Sessions: p.Sessions, Seed: p.Seed})
		if err != nil {
			return rep, fmt.Errorf("gen-history: %w", err)
		}
		t.Logf("generated %d bytes in %s", gr.Bytes, histDir)

		if wantAny("B3", "B4", "B5", "B8", "B1", "B2", "B6", "B10") {
			removeDB(goldenDB)
			b4, b5, fp, dur, err := measureBackfill(t, bin, work, histDir, goldenDB, p)
			goldenFP, importDur = fp, dur
			if wantBudget("B4") {
				rep.add(b4)
			}
			if wantBudget("B5") {
				rep.add(b5)
			}
			importOK = err == nil
			if err != nil {
				t.Logf("first import did not finish: %v (B4/B5 recorded; skip B8/B3 that need a golden DB)", err)
				rep.Notes = append(rep.Notes, "first import did not finish: "+err.Error())
			}
		}
	}

	if wantBudget("B3") {
		if importOK {
			b3, err := measureRestart(t, bin, work, histDir, goldenDB, p)
			if err != nil {
				rep.add(Budget{ID: "B3", Name: "No-op restart", Target: "≤2s wall, ≤1 CPU-s, zero file-level writes", Measured: err.Error(), Pass: false, Representative: !p.SmallCorpus()})
			} else {
				rep.add(b3)
			}
		} else {
			rep.add(Budget{ID: "B3", Name: "No-op restart", Target: "≤2s wall, ≤1 CPU-s, zero file-level writes", Measured: "skipped: no golden import", Pass: false, Representative: !p.SmallCorpus()})
		}
	}

	if wantBudget("B8") {
		if importOK {
			b8, err := measureCrash(t, bin, work, histDir, goldenDB, goldenFP, snapFile(goldenDB).Size, importDur, p)
			if err != nil {
				rep.add(Budget{ID: "B8", Name: "Resume after SIGKILL", Target: "counts, cost, session hash match clean import; no imported-without-rows", Measured: err.Error(), Pass: false, Notes: "harness error", Representative: !p.SmallCorpus()})
			} else {
				rep.add(b8)
			}
		} else {
			rep.add(Budget{ID: "B8", Name: "Resume after SIGKILL", Target: "counts, cost, session hash match clean import; no imported-without-rows", Measured: "skipped: no golden import", Pass: false, Notes: "first import did not finish", Representative: !p.SmallCorpus()})
		}
	}

	if wantAny("B1", "B2", "B10") {
		if _, err := os.Stat(goldenDB); err != nil {
			t.Logf("no golden DB (%v); skipping B1/B2/B10", err)
			if wantBudget("B1") {
				rep.add(Budget{ID: "B1", Name: "Idle engine CPU", Target: "≤3 CPU-s in 10 min window-closed; Electron main ≤2 CPU-s", Measured: "skipped: no golden import", Pass: false, Representative: !p.ShortIdle()})
			}
			if wantBudget("B2") {
				rep.add(Budget{ID: "B2", Name: "Idle disk writes", Target: "DB and WAL size and mtime unchanged", Measured: "skipped: no golden import", Pass: false, Representative: !p.ShortIdle()})
			}
			if wantBudget("B10") {
				rep.add(Budget{ID: "B10", Name: "API latency", Target: "p95 <100ms target, <300ms hard", Measured: "skipped: no golden import", Pass: false})
			}
		} else {
			idleProc, err := Start(StartOpts{
				Bin: bin, Dir: filepath.Join(work, "idle"), HistoryDir: histDir,
				DB:       copyDB(t, goldenDB, filepath.Join(work, "idle.duckdb")),
				ExtraEnv: []string{"AFTERTRACE_PPROF=1"},
			})
			if err != nil {
				return rep, err
			}
			if err := idleProc.WaitReady(3 * time.Minute); err != nil {
				_ = idleProc.Kill()
				return rep, err
			}
			if err := idleProc.WaitWarm(p.ImportWait()); err != nil {
				note := "invalid: not warm (" + err.Error() + "); import CPU would be counted as idle"
				t.Log(note)
				if wantBudget("B1") {
					rep.add(Budget{ID: "B1", Name: "Idle engine CPU", Target: "≤3 CPU-s in 10 min window-closed; Electron main ≤2 CPU-s", Measured: err.Error(), Pass: false, Invalid: true, Notes: note, Representative: !p.ShortIdle()})
				}
				if wantBudget("B2") {
					rep.add(Budget{ID: "B2", Name: "Idle disk writes", Target: "DB and WAL size and mtime unchanged", Measured: err.Error(), Pass: false, Invalid: true, Notes: note, Representative: !p.ShortIdle()})
				}
				if wantBudget("B10") {
					rep.add(Budget{ID: "B10", Name: "API latency", Target: "p95 <100ms target, <300ms hard", Measured: "skipped: not warm", Pass: false, Invalid: true})
				}
			} else {
				time.Sleep(settleAfterWarm)
				if wantBudget("B1") || wantBudget("B2") {
					b1, b2, sc := measureIdleClosed(t, idleProc, p, work)
					if wantBudget("B1") {
						rep.add(b1)
					}
					if wantBudget("B2") {
						rep.add(b2)
					}
					rep.Scenarios = append(rep.Scenarios, sc)
				}
				if wantBudget("B1") {
					for _, name := range []string{ScenarioOpenIdle, ScenarioLive} {
						sc := measureIdleScenario(t, idleProc, p, name)
						rep.Scenarios = append(rep.Scenarios, sc)
					}
					none := measureNoTraffic(t, idleProc, p)
					rep.Isolation = append(rep.Isolation, none)
					rep.Isolation = append(rep.Isolation, measureIsolation(t, idleProc, p)...)
					rep.Pprof = captureClosedPprof(t, idleProc, work, p.Isolation())
				}
				if wantBudget("B10") {
					rep.add(measureLatency(t, idleProc, p))
				}
			}
			_ = idleProc.Stop()
		}
	}

	if wantBudget("B6") {
		rep.add(measureLoad(t, bin, work, histDir, p))
	}
	if wantBudget("B7a") {
		rep.add(measureLateCost(t, bin, work, p))
	}
	if wantBudget("B7b") {
		rep.add(measureDupReplay(t, bin, work, p))
	}
	if wantBudget("B9") {
		rep.add(measureFailStore(t, bin, work, p))
	}

	return rep, nil
}

func measureBackfill(t *testing.T, bin, work, hist, db string, p Profile) (Budget, Budget, tableFP, time.Duration, error) {
	dir := filepath.Join(work, "backfill")
	t0 := time.Now()
	proc, err := Start(StartOpts{Bin: bin, Dir: dir, HistoryDir: hist, DB: db, ExitAfterWarm: true})
	if err != nil {
		return Budget{}, Budget{}, tableFP{}, 0, err
	}
	stop := make(chan struct{})
	spill := watchSpill(db, stop, p.SpillEvery)
	var peak uint64
	var peakMu sync.Mutex
	done := make(chan struct{})
	go func() {
		defer close(done)
		tk := time.NewTicker(p.RSSEvery)
		defer tk.Stop()
		for {
			select {
			case <-stop:
				return
			case <-tk.C:
				if rss, err := RSS(proc.PID()); err == nil {
					peakMu.Lock()
					if rss > peak {
						peak = rss
					}
					peakMu.Unlock()
				}
			}
		}
	}()
	waitErr := proc.WaitExit(p.ImportWait())
	wall := time.Since(t0)
	cpu := CPUFromState(proc.Cmd.ProcessState)
	close(stop)
	<-done
	peakMu.Lock()
	peakMB := float64(peak) / (1024 * 1024)
	peakMu.Unlock()
	hits := uniquePaths(spill.Hits())
	b4 := Budget{
		ID: "B4", Name: "Backfill peak RSS", Target: "≤350 MB on 2 GiB",
		Measured: map[string]any{
			"peak_rss_mb": round1(peakMB), "wall_s": wall.Seconds(), "cpu_s": cpu,
			"corpus": p.CorpusNote(), "memory_limit": "256MB DSN (244 MiB)",
		},
		Pass:           waitErr == nil && peak > 0 && peak <= 350<<20,
		Notes:          fmt.Sprintf("first import start-to-warm, RSS every %s; DSN memory_limit=256MB (244 MiB)", p.RSSEvery),
		Representative: !p.SmallCorpus(),
	}
	b5 := Budget{
		ID: "B5", Name: "No temp spill", Target: "no <db>.tmp and no temp_directory files",
		Measured:       map[string]any{"hits": len(hits), "paths": hits, "corpus": p.CorpusNote(), "wall_s": wall.Seconds()},
		Pass:           len(hits) == 0,
		Notes:          "checked every 500ms during first import",
		Representative: !p.SmallCorpus(),
	}
	if waitErr != nil {
		b4.Notes += "; import did not finish: " + waitErr.Error()
		t.Logf("B4 peak RSS %.1f MB wall=%s cpu=%.3fs (import failed: %v); B5 spill hits %d", peakMB, wall.Truncate(time.Millisecond), cpu, waitErr, len(hits))
		fp, fpErr := fingerprint(db)
		if fpErr != nil {
			return b4, b5, tableFP{}, wall, fmt.Errorf("backfill: %w", waitErr)
		}
		return b4, b5, fp, wall, fmt.Errorf("backfill: %w", waitErr)
	}
	fp, err := fingerprint(db)
	if err != nil {
		return b4, b5, tableFP{}, wall, err
	}
	t.Logf("B4 peak RSS %.1f MB wall=%s cpu=%.3fs; B5 spill hits %d; golden spans=%d", peakMB, wall.Truncate(time.Millisecond), cpu, len(hits), fp.Spans)
	return b4, b5, fp, wall, nil
}

func measureRestart(t *testing.T, bin, work, hist, golden string, p Profile) (Budget, error) {
	db := copyDB(t, golden, filepath.Join(work, "restart.duckdb"))
	before := []FileSnap{snapHashed(db), snapHashed(db + ".wal")}
	t0 := time.Now()
	proc, err := Start(StartOpts{Bin: bin, Dir: filepath.Join(work, "restart"), HistoryDir: hist, DB: db, ExitAfterWarm: true})
	if err != nil {
		return Budget{}, err
	}
	b3Wait := 10 * time.Minute
	if p.ImportWait() < b3Wait {
		b3Wait = p.ImportWait()
	}
	err = proc.WaitExit(b3Wait)
	wall := time.Since(t0)
	cpu := CPUFromState(proc.Cmd.ProcessState)
	after := []FileSnap{snapHashed(db), snapHashed(db + ".wal")}
	recycleLogged := ScanLogLines(proc.LogPath, func(s string) bool {
		return strings.Contains(s, "harness: store recycle")
	})
	writes := filesChanged(before, after) || recycleLogged
	tail := proc.tailLog()
	tsLog := filepath.Join(work, fmt.Sprintf("b3-serve-%s.log", time.Now().UTC().Format("20060102T150405Z")))
	if b, readErr := os.ReadFile(proc.LogPath); readErr == nil {
		_ = os.WriteFile(tsLog, b, 0o644)
	}
	if err != nil {
		t.Logf("B3 did not exit wall=%s cpu=%.3fs writes=%v: %v", wall.Truncate(time.Millisecond), cpu, writes, err)
		return Budget{
			ID: "B3", Name: "No-op restart", Target: "≤2s wall, ≤1 CPU-s, zero file-level writes (DB/WAL size, mtime, hash)",
			Measured: map[string]any{
				"wall_s": wall.Seconds(), "cpu_s": cpu, "writes": writes,
				"timeout": true, "error": err.Error(), "log_tail": tail, "serve_log": tsLog,
				"before": before, "after": after, "corpus": p.CorpusNote(),
			},
			Pass:           false,
			Notes:          "serve --exit-after-warm did not finish; wall, CPU and log tail kept. Check whether import was still running.",
			Representative: !p.SmallCorpus(),
		}, nil
	}
	pass := wall <= 2*time.Second && cpu <= 1 && !writes
	t.Logf("B3 wall=%s cpu=%.3fs writes=%v db %d→%d wal exists=%v→%v", wall.Truncate(time.Millisecond), cpu, writes, before[0].Size, after[0].Size, before[1].Exists, after[1].Exists)
	return Budget{
		ID: "B3", Name: "No-op restart", Target: "≤2s wall, ≤1 CPU-s, zero file-level writes (DB/WAL size, mtime, hash)",
		Measured: map[string]any{
			"wall_s": wall.Seconds(), "cpu_s": cpu, "writes": writes,
			"before": before, "after": after, "corpus": p.CorpusNote(),
			"log_tail": tail, "serve_log": tsLog,
		},
		Pass:           pass,
		Notes:          "serve --exit-after-warm on a copy of the golden DB; Open is writing (schema/recycle/Reopen). Fingerprint is read-only.",
		Representative: !p.SmallCorpus(),
	}, nil
}

func measureIdleClosed(t *testing.T, proc *Proc, p Profile, work string) (Budget, Budget, ScenarioCPU) {
	db, wal := snapFile(proc.DB), snapFile(proc.DB+".wal")
	stopPM := startPowermetrics(t, filepath.Join(work, "powermetrics.txt"))
	sc := measureIdleScenario(t, proc, p, ScenarioClosed)
	stopPM()
	db2, wal2 := snapFile(proc.DB), snapFile(proc.DB+".wal")
	disk := (db2.Size != db.Size || !mtimeEq(db, db2) || wal2.Size != wal.Size || !mtimeEq(wal, wal2))
	quota := 3.0 * p.Idle.Seconds() / (10 * time.Minute).Seconds()
	b1 := Budget{
		ID: "B1", Name: "Idle engine CPU", Target: "≤3 CPU-s in 10 min window-closed; Electron main ≤2 CPU-s",
		Measured: map[string]any{
			"cpu_s": sc.CPUSeconds, "wall_s": sc.WallSeconds, "quota_cpu_s_for_window": quota,
			"idle_window": p.Idle.String(), "scenario": ScenarioClosed, "hits": sc.Hits, "corpus": p.CorpusNote(),
		},
		Pass:           sc.CPUSeconds >= 0 && sc.CPUSeconds <= quota+1e-9,
		Notes:          "WINDOW CLOSED: supervisor health 1s, tray health+glance 60s. Settle " + settleAfterWarm.String() + " after warm. Electron main TODO. Sampled every 1s.",
		Corpus:         p.CorpusNote(),
		Representative: !p.ShortIdle(),
	}
	if why, ok := closedWindowValid(sc, p.Idle); !ok {
		b1.Invalid = true
		b1.Pass = false
		b1.Notes += "; invalid: " + why
		t.Logf("B1 INVALID: %s", why)
	}
	b2 := Budget{
		ID: "B2", Name: "Idle disk writes", Target: "DB and WAL size and mtime unchanged",
		Measured: map[string]any{
			"db_before": db, "db_after": db2, "wal_before": wal, "wal_after": wal2,
			"changed": disk, "idle_window": p.Idle.String(), "corpus": p.CorpusNote(),
		},
		Pass:           !disk,
		Notes:          "same WINDOW CLOSED window as B1",
		Representative: !p.ShortIdle(),
	}
	t.Logf("B1 closed cpu=%.3fs / %s (quota %.3f) hits=%v; B2 disk_changed=%v", sc.CPUSeconds, p.Idle, quota, sc.Hits, disk)
	return b1, b2, sc
}

func measureIdleScenario(t *testing.T, proc *Proc, p Profile, scenario string) ScenarioCPU {
	quota := 3.0 * p.Idle.Seconds() / (10 * time.Minute).Seconds()
	cpu0, err := CPUSeconds(proc.PID())
	stop := make(chan struct{})
	tr := startScenario(proc, scenario, stop)
	t0 := time.Now()
	time.Sleep(p.Idle)
	close(stop)
	wall := time.Since(t0)
	cpu1, err2 := CPUSeconds(proc.PID())
	cpu := -1.0
	if err == nil && err2 == nil {
		cpu = cpu1 - cpu0
	} else if err != nil {
		t.Logf("%s cpu: %v", scenario, err)
	} else {
		t.Logf("%s cpu: %v", scenario, err2)
	}
	hits := tr.snapshot()
	t.Logf("%s cpu=%.3fs / %s hits=%v", scenario, cpu, p.Idle, hits)
	return ScenarioCPU{
		Name: scenario, CPUSeconds: cpu, WallSeconds: wall.Seconds(),
		Quota: quota, Window: p.Idle.String(), Hits: hits,
	}
}

func measureIsolation(t *testing.T, proc *Proc, p Profile) []EndpointCPU {
	d := p.Isolation()
	var out []EndpointCPU
	for _, ep := range IsolationEndpoints {
		ep := ep
		cpu, wall, err := measureCPUWindow(t, proc, d, func(stop <-chan struct{}) {
			hit := func() { _, _, _, _ = proc.GET(ep.Path) }
			hit()
			tk := time.NewTicker(time.Second)
			defer tk.Stop()
			for {
				select {
				case <-stop:
					return
				case <-tk.C:
					hit()
				}
			}
		})
		if err != nil {
			t.Logf("isolation %s: %v", ep.Name, err)
			cpu = -1
		}
		row := EndpointCPU{Name: ep.Name, Path: ep.Path, CPUSeconds: cpu, WallSeconds: wall.Seconds(), Window: d.String()}
		out = append(out, row)
		t.Logf("isolation %s cpu=%.3fs / %s", ep.Name, cpu, d)
		time.Sleep(time.Second)
	}
	return out
}

func measureLatency(t *testing.T, proc *Proc, p Profile) Budget {
	lat := map[string][]time.Duration{}
	hard := 300 * time.Millisecond
	want := 100 * time.Millisecond
	pass := true
	summary := map[string]any{}
	for i := 0; i < 40; i++ {
		for _, ep := range []string{"/api/overview", "/api/sessions", "/api/findings", "/api/status", "/api/glance", "/api/health"} {
			st, body, d, err := proc.GET(ep)
			lat[ep] = append(lat[ep], d)
			if err != nil || st != 200 {
				pass = false
				t.Logf("B10 %s: st=%d err=%v body=%s", ep, st, err, trim(body, 80))
			}
		}
	}
	for _, ep := range []string{"/api/overview", "/api/sessions", "/api/findings", "/api/status", "/api/glance", "/api/health"} {
		p95 := percentile(lat[ep], 95)
		summary[ep] = map[string]any{"p95_ms": p95.Seconds() * 1000, "n": len(lat[ep])}
		if p95 > hard {
			pass = false
		} else if p95 > want {
			t.Logf("B10 WARN %s p95 %s exceeds 100ms target", ep, p95)
		}
	}
	return Budget{
		ID: "B10", Name: "API latency", Target: "p95 <100ms target, <300ms hard",
		Measured: summary, Pass: pass,
		Notes:          "same endpoints as internal/perf; this run uses the harness corpus, not the 92k seed",
		Corpus:         p.CorpusNote(),
		Representative: !p.SmallCorpus(),
	}
}

func measureLoad(t *testing.T, bin, work, hist string, p Profile) Budget {
	dir := filepath.Join(work, "load")
	db := filepath.Join(work, "load.duckdb")
	removeDB(db)
	reopen := filepath.Join(dir, "reopen.flag")
	proc, err := Start(StartOpts{Bin: bin, Dir: dir, HistoryDir: hist, DB: db, Reopen: reopen})
	if err != nil {
		return Budget{ID: "B6", Name: "Reads under load", Target: "all 200; no 5xx, no database is closed, no 503; Reopen in window", Measured: err.Error(), Pass: false}
	}
	defer proc.Stop()
	if err := proc.WaitReady(2 * time.Minute); err != nil {
		return Budget{ID: "B6", Name: "Reads under load", Target: "all 200; no 5xx, no database is closed, no 503; Reopen in window", Measured: err.Error(), Pass: false}
	}
	if err := proc.WaitWarm(p.ImportWait()); err != nil {
		return Budget{
			ID: "B6", Name: "Reads under load", Target: "all 200; no 5xx, no database is closed, no 503; Reopen in window",
			Measured:       err.Error(),
			Pass:           false,
			Invalid:        true,
			Notes:          "invalid: import still running; Reopen would wait on the write lock. " + err.Error(),
			Representative: !p.SmallCorpus(),
		}
	}
	eps := append([]string{}, getEndpoints...)
	var extra []string
	var sess []struct {
		ID string `json:"session_id"`
	}
	_ = proc.JSON("/api/sessions", &sess)
	if len(sess) > 0 {
		extra = append(extra, "/api/session/"+sess[0].ID)
	}
	eps = append(eps, extra...)

	var n200, n5xx, n503, nClosed, nOther, nErr atomic.Int64
	var errMu sync.Mutex
	var errSamples []string
	stop := make(chan struct{})
	var wg sync.WaitGroup
	t0 := time.Now()
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			tk := time.NewTicker(250 * time.Millisecond)
			defer tk.Stop()
			for {
				select {
				case <-stop:
					return
				case <-tk.C:
					for _, ep := range eps {
						st, body, _, err := proc.GET(ep)
						if err != nil {
							nErr.Add(1)
							errMu.Lock()
							if len(errSamples) < 8 {
								errSamples = append(errSamples, err.Error())
							}
							errMu.Unlock()
							continue
						}
						switch {
						case st == 200:
							n200.Add(1)
						case st == 503:
							n503.Add(1)
						case st >= 500:
							n5xx.Add(1)
						default:
							nOther.Add(1)
						}
						if strings.Contains(string(body), "database is closed") {
							nClosed.Add(1)
						}
					}
				}
			}
		}()
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		tk := time.NewTicker(time.Second / time.Duration(p.OTLPRate))
		defer tk.Stop()
		i := 0
		now := uint64(time.Now().UnixNano())
		for {
			select {
			case <-stop:
				return
			case <-tk.C:
				_ = sendHTTP(proc, makeBatch(100000+i, now+uint64(i)*1e6))
				i++
			}
		}
	}()
	time.Sleep(2 * time.Second)
	if err := os.WriteFile(reopen, []byte("1"), 0o644); err != nil {
		t.Logf("B6 reopen sentinel: %v", err)
	}
	reopened := false
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if ScanLogLines(proc.LogPath, func(s string) bool {
			return strings.Contains(s, "reopen: harness trigger")
		}) {
			reopened = true
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	remain := p.Load - time.Since(t0)
	if remain > 0 {
		time.Sleep(remain)
	}
	close(stop)
	wg.Wait()
	ok := n5xx.Load() == 0 && n503.Load() == 0 && nClosed.Load() == 0 && nErr.Load() == 0 && nOther.Load() == 0 && reopened
	t.Logf("B6 200=%d 5xx=%d 503=%d closed=%d other=%d err=%d reopened=%v transport=%v", n200.Load(), n5xx.Load(), n503.Load(), nClosed.Load(), nOther.Load(), nErr.Load(), reopened, errSamples)
	b := Budget{
		ID: "B6", Name: "Reads under load", Target: "all 200; no 5xx, no database is closed, no 503; Reopen in window",
		Measured: map[string]any{
			"n200": n200.Load(), "n5xx": n5xx.Load(), "n503": n503.Load(),
			"database_is_closed": nClosed.Load(), "other": nOther.Load(), "err": nErr.Load(),
			"reopened": reopened, "seconds": p.Load.Seconds(), "readers": 8, "otlp_batches_per_s": p.OTLPRate,
			"transport_errors": errSamples,
		},
		Pass:           ok,
		Notes:          "8 readers × every GET at 4 Hz while OTLP replays and history backfill runs; AFTERTRACE_REOPEN sentinel forces a recycle in-window",
		Representative: !p.SmallCorpus(),
	}
	if !reopened {
		b.Invalid = true
		b.Pass = false
		b.Notes = "invalid: AFTERTRACE_REOPEN did not fire in-window (Reopen waits on the import write lock); not scored as a miss. Transport errors: " + strings.Join(errSamples, "; ")
	}
	return b
}

func measureLateCost(t *testing.T, bin, work string, p Profile) Budget {
	db := filepath.Join(work, "late.duckdb")
	removeDB(db)
	proc, err := Start(StartOpts{Bin: bin, Dir: filepath.Join(work, "late"), DB: db, NoHistory: true})
	if err != nil {
		return Budget{ID: "B7a", Name: "Late-arriving cost (copies=1)", Target: "rollups = INPUT oracle including trace/session/day cost", Measured: err.Error(), Pass: false}
	}
	if err := proc.WaitReady(time.Minute); err != nil {
		_ = proc.Kill()
		return Budget{ID: "B7a", Name: "Late-arriving cost (copies=1)", Target: "rollups = INPUT oracle including trace/session/day cost", Measured: err.Error(), Pass: false}
	}
	acc := replayLateCost(proc, p.OTLPBatches, p.OTLPRate)
	_ = proc.Stop()
	st, err := store.OpenReadOnly(db)
	if err != nil {
		return Budget{ID: "B7a", Name: "Late-arriving cost (copies=1)", Target: "rollups = INPUT oracle including trace/session/day cost", Measured: err.Error(), Pass: false}
	}
	defer st.Close()
	want := InputOTLP(p.OTLPBatches)
	got, err := ReadRollups(st.DB)
	if err != nil {
		return Budget{ID: "B7a", Name: "Late-arriving cost (copies=1)", Target: "rollups = INPUT oracle including trace/session/day cost", Measured: err.Error(), Pass: false}
	}
	diffs := CompareFacts(got, want)
	t.Logf("B7a diffs=%d http_ok=%d trace_cost got=%g want=%g", len(diffs), acc.OK, got.TraceCost, want.TraceCost)
	return Budget{
		ID: "B7a", Name: "Late-arriving cost (copies=1)", Target: "rollups = INPUT oracle including trace/session/day cost",
		Measured:       map[string]any{"diffs": diffs, "input": want, "rollups": got, "replay": acc},
		Pass:           len(diffs) == 0,
		Notes:          fmt.Sprintf("single copy of %d batches: traces first, then api_request cost. refreshTraces builds trace_roots when spans arrive and never reapplies later cost. Owner: PR 6 (same rollup/cost path as B7b).", p.OTLPBatches),
		Representative: true,
	}
}

func measureDupReplay(t *testing.T, bin, work string, p Profile) Budget {
	db := filepath.Join(work, "dup.duckdb")
	removeDB(db)
	proc, err := Start(StartOpts{Bin: bin, Dir: filepath.Join(work, "dup"), DB: db, NoHistory: true})
	if err != nil {
		return Budget{ID: "B7b", Name: "Counts with duplicates", Target: "rollups = INPUT oracle; cost within 1e-6", Measured: err.Error(), Pass: false}
	}
	if err := proc.WaitReady(time.Minute); err != nil {
		_ = proc.Kill()
		return Budget{ID: "B7b", Name: "Counts with duplicates", Target: "rollups = INPUT oracle; cost within 1e-6", Measured: err.Error(), Pass: false}
	}
	acc := replayShuffled(proc, p.OTLPBatches, p.OTLPCopies, p.Seed, p.OTLPRate)
	_ = proc.Stop()
	st, err := store.OpenReadOnly(db)
	if err != nil {
		return Budget{ID: "B7b", Name: "Counts with duplicates", Target: "rollups = INPUT oracle; cost within 1e-6", Measured: err.Error(), Pass: false}
	}
	defer st.Close()
	want := InputOTLP(p.OTLPBatches)
	got, err := ReadRollups(st.DB)
	if err != nil {
		return Budget{ID: "B7b", Name: "Counts with duplicates", Target: "rollups = INPUT oracle; cost within 1e-6", Measured: err.Error(), Pass: false}
	}
	diffs := CompareFacts(got, want)
	t.Logf("B7b diffs=%d http_ok=%d events got=%d want=%d", len(diffs), acc.OK, got.Events, want.Events)
	return Budget{
		ID: "B7b", Name: "Counts with duplicates", Target: "rollups = INPUT oracle; cost within 1e-6",
		Measured:       map[string]any{"diffs": diffs, "input": want, "rollups": got, "replay": acc},
		Pass:           len(diffs) == 0,
		Notes:          fmt.Sprintf("each of %d batches replayed %d times, shuffled; expected values from unique input keys, not a recount of the DB under test. Owner: PR 6.", p.OTLPBatches, p.OTLPCopies),
		Representative: true,
	}
}

func measureFailStore(t *testing.T, bin, work string, p Profile) Budget {
	dir := filepath.Join(work, "fail")
	trip := filepath.Join(dir, "fail.flag")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return Budget{ID: "B9", Name: "OTLP never lost silently", Target: "HTTP 503 AND gRPC UNAVAILABLE; events present exactly once", Measured: err.Error(), Pass: false}
	}
	if err := os.WriteFile(trip, []byte("1"), 0o644); err != nil {
		return Budget{ID: "B9", Name: "OTLP never lost silently", Target: "HTTP 503 AND gRPC UNAVAILABLE; events present exactly once", Measured: err.Error(), Pass: false}
	}
	proc, err := Start(StartOpts{Bin: bin, Dir: dir, DB: filepath.Join(dir, "fail.duckdb"), NoHistory: true, FailStore: trip})
	if err != nil {
		return Budget{ID: "B9", Name: "OTLP never lost silently", Target: "HTTP 503 AND gRPC UNAVAILABLE; events present exactly once", Measured: err.Error(), Pass: false}
	}
	defer proc.Stop()
	if err := proc.WaitReady(time.Minute); err != nil {
		return Budget{ID: "B9", Name: "OTLP never lost silently", Target: "HTTP 503 AND gRPC UNAVAILABLE; events present exactly once", Measured: err.Error(), Pass: false}
	}
	b := makeBatch(1, uint64(time.Now().UnixNano()))
	failHTTP := sendHTTP(proc, b)
	failGRPC := sendGRPC(proc, b)
	_ = os.Remove(trip)
	time.Sleep(50 * time.Millisecond)
	okHTTP := sendHTTP(proc, b)
	_ = proc.Stop()
	st, err := store.OpenReadOnly(filepath.Join(dir, "fail.duckdb"))
	nevents := -1
	if err != nil {
		return Budget{ID: "B9", Name: "OTLP never lost silently", Target: "HTTP 503 AND gRPC UNAVAILABLE; events present exactly once", Measured: err.Error(), Pass: false}
	}
	if err := st.DB.QueryRow(`SELECT count(*) FROM events`).Scan(&nevents); err != nil {
		st.Close()
		return Budget{ID: "B9", Name: "OTLP never lost silently", Target: "HTTP 503 AND gRPC UNAVAILABLE; events present exactly once", Measured: err.Error(), Pass: false}
	}
	st.Close()
	exporterOK := failHTTP.Status503 > 0 && failGRPC.Unavailable > 0
	once := nevents == 1
	t.Logf("B9 fail HTTP=%+v gRPC=%+v after_ok=%+v events=%d", failHTTP, failGRPC, okHTTP, nevents)
	return Budget{
		ID: "B9", Name: "OTLP never lost silently", Target: "HTTP 503 AND gRPC UNAVAILABLE; events present exactly once",
		Measured: map[string]any{
			"during_fail_http": failHTTP, "during_fail_grpc": failGRPC,
			"after_http": okHTTP, "event_rows": nevents,
		},
		Pass:           exporterOK && once && okHTTP.OK > 0,
		Notes:          "AFTERTRACE_FAIL_STORE sentinel; exactly-once is on events (spans already PK-dedupe) and is trivially true today because the fail path writes nothing. PR 7 owns a real failure-after-commit-plus-retry test. Current engine may return 400/Unknown instead of 503/UNAVAILABLE.",
		Representative: true,
	}
}

func fingerprint(dbPath string) (tableFP, error) {
	st, err := store.OpenReadOnly(dbPath)
	if err != nil {
		return tableFP{}, err
	}
	defer st.Close()
	return fingerprintDB(st)
}

func fingerprintDB(st *store.Store) (tableFP, error) {
	var fp tableFP
	err := st.DB.QueryRow(`SELECT
		(SELECT count(*) FROM spans),
		(SELECT count(*) FROM events),
		(SELECT count(*) FROM span_events),
		(SELECT count(*) FROM metric_points),
		(SELECT count(*) FROM history_files WHERE status='imported'),
		(SELECT coalesce(max(imported_at_ns),0) FROM history_files)`).
		Scan(&fp.Spans, &fp.Events, &fp.SpanEvents, &fp.Metrics, &fp.HistImported, &fp.ImportedAtMax)
	if err != nil {
		return fp, err
	}
	if err := st.DB.QueryRow(`SELECT coalesce(sum(cost_usd),0) FROM llm_facts`).Scan(&fp.LLMCost); err != nil {
		return fp, fmt.Errorf("llm_facts.cost: %w", err)
	}
	if err := st.DB.QueryRow(`SELECT coalesce(sum(cost_usd),0) FROM trace_roots`).Scan(&fp.TraceCost); err != nil {
		return fp, fmt.Errorf("trace_roots.cost: %w", err)
	}
	if err := st.DB.QueryRow(`SELECT coalesce(sum(cost_usd),0) FROM session_stats`).Scan(&fp.SessionCost); err != nil {
		return fp, fmt.Errorf("session_stats.cost: %w", err)
	}
	if err := st.DB.QueryRow(`SELECT coalesce(sum(cost_usd),0) FROM day_stats`).Scan(&fp.DayCost); err != nil {
		return fp, fmt.Errorf("day_stats.cost: %w", err)
	}
	if err := st.DB.QueryRow(`SELECT coalesce(sum(cost_usd),0) FROM model_stats`).Scan(&fp.ModelCost); err != nil {
		return fp, fmt.Errorf("model_stats.cost: %w", err)
	}
	if err := st.DB.QueryRow(`SELECT count(*) FROM history_files hf WHERE status='imported' AND NOT EXISTS (
		SELECT 1 FROM spans s WHERE s.session_id = hf.session_id)`).Scan(&fp.ImportedWithoutRows); err != nil {
		return fp, fmt.Errorf("imported_without_rows: %w", err)
	}
	h, err := sessionKeyHash(st)
	if err != nil {
		return fp, err
	}
	fp.SessionHash = h
	return fp, nil
}

func sessionKeyHash(st *store.Store) (string, error) {
	rows, err := st.DB.Query(`SELECT session_id, count(*) FROM spans GROUP BY 1 ORDER BY 1`)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	h := sha256.New()
	for rows.Next() {
		var id string
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return "", err
		}
		fmt.Fprintf(h, "%s\t%d\n", id, n)
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func fpEqual(a, b tableFP) bool {
	if a.Spans != b.Spans || a.Events != b.Events || a.SpanEvents != b.SpanEvents || a.Metrics != b.Metrics {
		return false
	}
	if a.SessionHash != b.SessionHash || a.ImportedWithoutRows != b.ImportedWithoutRows {
		return false
	}
	near := func(x, y float64) bool { return math.Abs(x-y) <= costTol }
	return near(a.LLMCost, b.LLMCost) && near(a.TraceCost, b.TraceCost) && near(a.SessionCost, b.SessionCost) && near(a.DayCost, b.DayCost) && near(a.ModelCost, b.ModelCost)
}

func wantBudget(id string) bool {
	raw := strings.TrimSpace(os.Getenv("AFTERTRACE_HARNESS_ONLY"))
	if raw == "" {
		return true
	}
	for _, p := range strings.Split(raw, ",") {
		if strings.EqualFold(strings.TrimSpace(p), id) {
			return true
		}
	}
	return false
}

func wantAny(ids ...string) bool {
	if strings.TrimSpace(os.Getenv("AFTERTRACE_HARNESS_ONLY")) == "" {
		return true
	}
	for _, id := range ids {
		if wantBudget(id) {
			return true
		}
	}
	return false
}

func closedWindowValid(sc ScenarioCPU, idle time.Duration) (string, bool) {
	wall := time.Duration(sc.WallSeconds * float64(time.Second))
	lo := time.Duration(float64(idle) * 0.85)
	hi := time.Duration(float64(idle) * 1.25)
	if wall < lo || wall > hi {
		return fmt.Sprintf("window wall %s not in [0.85,1.25]×%s", wall.Truncate(time.Millisecond), idle), false
	}
	wantHits := int64(idle / time.Second)
	if wantHits < 1 {
		wantHits = 1
	}
	health := sc.Hits["supervisor_health"]
	hLo, hHi := wantHits*80/100, wantHits*120/100
	if hLo < 1 {
		hLo = 1
	}
	if health < hLo || health > hHi {
		return fmt.Sprintf("health hits %d want ~%d ±20%%", health, wantHits), false
	}
	return "", true
}

func removeDB(path string) {
	_ = os.Remove(path)
	_ = os.Remove(path + ".wal")
}

func copyDB(t *testing.T, src, dst string) string {
	t.Helper()
	removeDB(dst)
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		t.Fatalf("copy db mkdir: %v", err)
	}
	copyOne := func(from, to string, required bool) {
		in, err := os.Open(from)
		if err != nil {
			if !required && os.IsNotExist(err) {
				return
			}
			t.Fatalf("copy db open %s: %v", from, err)
		}
		defer in.Close()
		out, err := os.Create(to)
		if err != nil {
			t.Fatalf("copy db create %s: %v", to, err)
		}
		defer func() {
			if err := out.Close(); err != nil {
				t.Fatalf("copy db close %s: %v", to, err)
			}
		}()
		if _, err := io.Copy(out, in); err != nil {
			t.Fatalf("copy db stream %s: %v", to, err)
		}
	}
	copyOne(src, dst, true)
	copyOne(src+".wal", dst+".wal", false)
	return dst
}

func uniquePaths(hits []SpillHit) []string {
	seen := map[string]struct{}{}
	var out []string
	for _, h := range hits {
		if _, ok := seen[h.Path]; ok {
			continue
		}
		seen[h.Path] = struct{}{}
		out = append(out, h.Path)
	}
	return out
}

func round1(f float64) float64 { return math.Round(f*10) / 10 }

func percentile(ds []time.Duration, p int) time.Duration {
	if len(ds) == 0 {
		return 0
	}
	cp := append([]time.Duration(nil), ds...)
	for i := 0; i < len(cp); i++ {
		for j := i + 1; j < len(cp); j++ {
			if cp[j] < cp[i] {
				cp[i], cp[j] = cp[j], cp[i]
			}
		}
	}
	i := (p * (len(cp) - 1)) / 100
	return cp[i]
}
