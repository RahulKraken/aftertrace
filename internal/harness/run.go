//go:build unix

package harness

import (
	"fmt"
	"math"
	"math/rand/v2"
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
	)
	if p.SmallCorpus() {
		rep.Notes = append(rep.Notes, "Corpus smaller than 2 GiB: B3/B4/B5/B8 passes are not representative of a 735 MB field DB / 7.9 GB ~/.claude/projects / 244 MiB DuckDB cap.")
	}
	if p.ShortIdle() {
		rep.Notes = append(rep.Notes, "Idle window shorter than 10 minutes: B1/B2 cannot catch the 45s tray glance poll or the 30s findings refresh.")
	}

	histDir := filepath.Join(work, "projects")
	t.Logf("generating history %s", p.CorpusNote())
	gr, err := GenerateHistory(histDir, GenOpts{Size: p.Size, Sessions: p.Sessions, Seed: p.Seed})
	if err != nil {
		return rep, fmt.Errorf("gen-history: %w", err)
	}
	t.Logf("generated %d bytes in %s", gr.Bytes, histDir)

	goldenDB := filepath.Join(work, "golden.duckdb")
	b4, b5, goldenFP, importDur, err := measureBackfill(t, bin, work, histDir, goldenDB, p)
	rep.add(b4)
	rep.add(b5)
	importOK := err == nil
	if err != nil {
		t.Logf("first import did not finish: %v (B4/B5 recorded; skip B8/B3 that need a golden DB)", err)
		rep.Notes = append(rep.Notes, "first import did not finish: "+err.Error())
	}

	if importOK {
		b8, err := measureCrash(t, bin, work, histDir, goldenDB, goldenFP, importDur, p)
		if err != nil {
			rep.add(Budget{ID: "B8", Name: "Resume after SIGKILL", Target: "counts match clean import; no imported-without-rows", Measured: err.Error(), Pass: false, Notes: "harness error", Representative: !p.SmallCorpus()})
		} else {
			rep.add(b8)
		}

		b3, err := measureRestart(t, bin, work, histDir, goldenDB, goldenFP, p)
		if err != nil {
			rep.add(Budget{ID: "B3", Name: "No-op restart", Target: "≤2s wall, ≤1 CPU-s, zero data-table writes", Measured: err.Error(), Pass: false, Representative: !p.SmallCorpus()})
		} else {
			rep.add(b3)
		}
	} else {
		rep.add(Budget{ID: "B8", Name: "Resume after SIGKILL", Target: "counts match clean import; no imported-without-rows", Measured: "skipped: no golden import", Pass: false, Notes: "first import did not finish", Representative: !p.SmallCorpus()})
		rep.add(Budget{ID: "B3", Name: "No-op restart", Target: "≤2s wall, ≤1 CPU-s, zero data-table writes", Measured: "skipped: no golden import", Pass: false, Representative: !p.SmallCorpus()})
	}

	if _, err := os.Stat(goldenDB); err != nil {
		t.Logf("no golden DB (%v); skipping B1/B2/B10", err)
		rep.add(Budget{ID: "B1", Name: "Idle engine CPU", Target: "≤3 CPU-s in 10 min (engine); Electron main ≤2 CPU-s", Measured: "skipped: no golden import", Pass: false, Representative: !p.ShortIdle()})
		rep.add(Budget{ID: "B2", Name: "Idle disk writes", Target: "DB and WAL size and mtime unchanged", Measured: "skipped: no golden import", Pass: false, Representative: !p.ShortIdle()})
		rep.add(Budget{ID: "B10", Name: "API latency", Target: "p95 <100ms target, <300ms hard", Measured: "skipped: no golden import", Pass: false})
	} else {
		idleProc, err := Start(StartOpts{Bin: bin, Dir: filepath.Join(work, "idle"), HistoryDir: histDir, DB: copyDB(t, goldenDB, filepath.Join(work, "idle.duckdb"))})
		if err != nil {
			return rep, err
		}
		if err := idleProc.WaitReady(3 * time.Minute); err != nil {
			_ = idleProc.Kill()
			return rep, err
		}
		if err := idleProc.WaitWarm(p.ImportWait()); err != nil {
			t.Logf("idle warm wait: %v (continuing)", err)
		}

		b1, b2 := measureIdle(t, idleProc, p)
		rep.add(b1)
		rep.add(b2)

		b10 := measureLatency(t, idleProc, p)
		rep.add(b10)
		_ = idleProc.Stop()
	}

	b6 := measureLoad(t, bin, work, histDir, p)
	rep.add(b6)

	b7 := measureDupReplay(t, bin, work, p)
	rep.add(b7)

	b9 := measureFailStore(t, bin, work, p)
	rep.add(b9)

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

func measureRestart(t *testing.T, bin, work, hist, db string, before tableFP, p Profile) (Budget, error) {
	cpu0, _ := selfCPU()
	t0 := time.Now()
	proc, err := Start(StartOpts{Bin: bin, Dir: filepath.Join(work, "restart"), HistoryDir: hist, DB: db, ExitAfterWarm: true})
	if err != nil {
		return Budget{}, err
	}
	pid := proc.PID()
	err = proc.WaitExit(10 * time.Minute)
	wall := time.Since(t0)
	cpu := CPUFromState(proc.Cmd.ProcessState)
	_ = pid
	_ = cpu0
	if err != nil {
		return Budget{}, err
	}
	after, err := fingerprint(db)
	if err != nil {
		return Budget{}, err
	}
	writes := after != before
	pass := wall <= 2*time.Second && cpu <= 1 && !writes
	t.Logf("B3 wall=%s cpu=%.3fs writes=%v", wall.Truncate(time.Millisecond), cpu, writes)
	return Budget{
		ID: "B3", Name: "No-op restart", Target: "≤2s wall, ≤1 CPU-s, zero data-table writes",
		Measured: map[string]any{
			"wall_s": wall.Seconds(), "cpu_s": cpu, "writes": writes,
			"before": before, "after": after, "corpus": p.CorpusNote(),
		},
		Pass:           pass,
		Notes:          "serve --exit-after-warm on an unchanged corpus (skip + reopen)",
		Representative: !p.SmallCorpus(),
	}, nil
}

func measureIdle(t *testing.T, proc *Proc, p Profile) (Budget, Budget) {
	db, wal := snapFile(proc.DB), snapFile(proc.DB+".wal")
	cpu0, errCPU := CPUSeconds(proc.PID())
	wall0 := time.Now()
	stop := make(chan struct{})
	traffic := startDesktopIdle(proc, stop)
	samples := 0
	tk := time.NewTicker(p.IdleEvery)
	defer tk.Stop()
	end := time.Now().Add(p.Idle)
	for time.Now().Before(end) {
		<-tk.C
		samples++
		_, _ = CPUSeconds(proc.PID())
	}
	close(stop)
	cpu1, _ := CPUSeconds(proc.PID())
	cpu := cpu1 - cpu0
	if errCPU != nil {
		cpu = -1
	}
	db2, wal2 := snapFile(proc.DB), snapFile(proc.DB+".wal")
	disk := (db2.Size != db.Size || !mtimeEq(db, db2) || wal2.Size != wal.Size || !mtimeEq(wal, wal2))
	quota := 3.0 * p.Idle.Seconds() / (10 * time.Minute).Seconds()
	b1 := Budget{
		ID: "B1", Name: "Idle engine CPU", Target: "≤3 CPU-s in 10 min (engine); Electron main ≤2 CPU-s",
		Measured: map[string]any{
			"cpu_s": cpu, "wall_s": time.Since(wall0).Seconds(), "samples": samples,
			"quota_cpu_s_for_window": quota, "idle_window": p.Idle.String(),
			"health_hits": traffic.health.Load(), "glance_hits": traffic.glance.Load(),
			"findings_hits": traffic.findings.Load(), "corpus": p.CorpusNote(),
		},
		Pass:           cpu >= 0 && cpu <= quota+1e-9,
		Notes:          "tray stand-in: health 1s, glance 45s, findings 30s. Electron main TODO. Sampled every 1s.",
		Corpus:         p.CorpusNote(),
		Representative: !p.ShortIdle(),
	}
	b2 := Budget{
		ID: "B2", Name: "Idle disk writes", Target: "DB and WAL size and mtime unchanged",
		Measured: map[string]any{
			"db_before": db, "db_after": db2, "wal_before": wal, "wal_after": wal2,
			"changed": disk, "idle_window": p.Idle.String(), "corpus": p.CorpusNote(),
		},
		Pass:           !disk,
		Notes:          "same window as B1, with tray glance stand-in",
		Representative: !p.ShortIdle(),
	}
	t.Logf("B1 idle cpu=%.3fs / %s (quota %.3f) glance=%d findings=%d; B2 disk_changed=%v",
		cpu, p.Idle, quota, traffic.glance.Load(), traffic.findings.Load(), disk)
	return b1, b2
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
	proc, err := Start(StartOpts{Bin: bin, Dir: filepath.Join(work, "load"), HistoryDir: hist, DB: filepath.Join(work, "load.duckdb")})
	if err != nil {
		return Budget{ID: "B6", Name: "Reads under load", Target: "all 200; no 5xx, no database is closed, no 503", Measured: err.Error(), Pass: false}
	}
	defer proc.Stop()
	if err := proc.WaitReady(2 * time.Minute); err != nil {
		return Budget{ID: "B6", Name: "Reads under load", Target: "all 200; no 5xx, no database is closed, no 503", Measured: err.Error(), Pass: false}
	}
	eps := append([]string{}, getEndpoints...)
	var extra []string
	var sess struct {
		Sessions []struct {
			ID string `json:"session_id"`
		} `json:"sessions"`
	}
	_ = proc.JSON("/api/sessions", &sess)
	if len(sess.Sessions) > 0 {
		extra = append(extra, "/api/session/"+sess.Sessions[0].ID)
	}
	eps = append(eps, extra...)

	var n200, n5xx, n503, nClosed, nOther, nErr atomic.Int64
	stop := make(chan struct{})
	var wg sync.WaitGroup
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
	time.Sleep(p.Load)
	close(stop)
	wg.Wait()
	ok := n5xx.Load() == 0 && n503.Load() == 0 && nClosed.Load() == 0 && nErr.Load() == 0 && nOther.Load() == 0
	t.Logf("B6 200=%d 5xx=%d 503=%d closed=%d other=%d err=%d", n200.Load(), n5xx.Load(), n503.Load(), nClosed.Load(), nOther.Load(), nErr.Load())
	return Budget{
		ID: "B6", Name: "Reads under load", Target: "all 200; no 5xx, no database is closed, no 503",
		Measured: map[string]any{
			"n200": n200.Load(), "n5xx": n5xx.Load(), "n503": n503.Load(),
			"database_is_closed": nClosed.Load(), "other": nOther.Load(), "err": nErr.Load(),
			"seconds": p.Load.Seconds(), "readers": 8, "otlp_batches_per_s": p.OTLPRate,
		},
		Pass:           ok,
		Notes:          "8 readers × every GET at 4 Hz while OTLP replays and history backfill runs",
		Representative: !p.SmallCorpus(),
	}
}

func measureDupReplay(t *testing.T, bin, work string, p Profile) Budget {
	db := filepath.Join(work, "dup.duckdb")
	proc, err := Start(StartOpts{Bin: bin, Dir: filepath.Join(work, "dup"), DB: db, NoHistory: true})
	if err != nil {
		return Budget{ID: "B7", Name: "Counts with duplicates", Target: "rollups = oracle; cost within 1e-9", Measured: err.Error(), Pass: false}
	}
	if err := proc.WaitReady(time.Minute); err != nil {
		_ = proc.Kill()
		return Budget{ID: "B7", Name: "Counts with duplicates", Target: "rollups = oracle; cost within 1e-9", Measured: err.Error(), Pass: false}
	}
	acc := replayShuffled(proc, p.OTLPBatches, p.OTLPCopies, p.Seed, p.OTLPRate)
	_ = proc.Stop()
	st, err := store.Open(db)
	if err != nil {
		return Budget{ID: "B7", Name: "Counts with duplicates", Target: "rollups = oracle; cost within 1e-9", Measured: err.Error(), Pass: false}
	}
	defer st.Close()
	want, err := Oracle(st.DB)
	if err != nil {
		return Budget{ID: "B7", Name: "Counts with duplicates", Target: "rollups = oracle; cost within 1e-9", Measured: err.Error(), Pass: false}
	}
	got, err := ReadRollups(st.DB)
	if err != nil {
		return Budget{ID: "B7", Name: "Counts with duplicates", Target: "rollups = oracle; cost within 1e-9", Measured: err.Error(), Pass: false}
	}
	diffs := CompareFacts(got, want)
	t.Logf("B7 diffs=%d http_ok=%d", len(diffs), acc.OK)
	return Budget{
		ID: "B7", Name: "Counts with duplicates", Target: "rollups = oracle; cost within 1e-9",
		Measured:       map[string]any{"diffs": diffs, "oracle": want, "rollups": got, "replay": acc},
		Pass:           len(diffs) == 0,
		Notes:          fmt.Sprintf("each of %d batches replayed %d times, shuffled", p.OTLPBatches, p.OTLPCopies),
		Representative: true,
	}
}

func measureFailStore(t *testing.T, bin, work string, p Profile) Budget {
	dir := filepath.Join(work, "fail")
	trip := filepath.Join(dir, "fail.flag")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return Budget{ID: "B9", Name: "OTLP never lost silently", Target: "503 or UNAVAILABLE then present exactly once", Measured: err.Error(), Pass: false}
	}
	if err := os.WriteFile(trip, []byte("1"), 0o644); err != nil {
		return Budget{ID: "B9", Name: "OTLP never lost silently", Target: "503 or UNAVAILABLE then present exactly once", Measured: err.Error(), Pass: false}
	}
	proc, err := Start(StartOpts{Bin: bin, Dir: dir, DB: filepath.Join(dir, "fail.duckdb"), NoHistory: true, FailStore: trip})
	if err != nil {
		return Budget{ID: "B9", Name: "OTLP never lost silently", Target: "503 or UNAVAILABLE then present exactly once", Measured: err.Error(), Pass: false}
	}
	defer proc.Stop()
	if err := proc.WaitReady(time.Minute); err != nil {
		return Budget{ID: "B9", Name: "OTLP never lost silently", Target: "503 or UNAVAILABLE then present exactly once", Measured: err.Error(), Pass: false}
	}
	b := makeBatch(1, uint64(time.Now().UnixNano()))
	failHTTP := sendHTTP(proc, b)
	failGRPC := sendGRPC(proc, b)
	_ = os.Remove(trip)
	time.Sleep(50 * time.Millisecond)
	okHTTP := sendHTTP(proc, b)
	_ = proc.Stop()
	st, err := store.Open(filepath.Join(dir, "fail.duckdb"))
	nspans := -1
	if err == nil {
		_ = st.DB.QueryRow(`SELECT count(*) FROM spans`).Scan(&nspans)
		st.Close()
	}
	exporterOK := (failHTTP.Status503 > 0 || failGRPC.Unavailable > 0)
	once := nspans == 2 // interaction + llm
	t.Logf("B9 fail HTTP=%+v gRPC=%+v after_ok=%+v spans=%d", failHTTP, failGRPC, okHTTP, nspans)
	return Budget{
		ID: "B9", Name: "OTLP never lost silently", Target: "exporters get 503 or UNAVAILABLE; after recovery data present exactly once",
		Measured: map[string]any{
			"during_fail_http": failHTTP, "during_fail_grpc": failGRPC,
			"after_http": okHTTP, "span_rows": nspans,
		},
		Pass:           exporterOK && once && okHTTP.OK > 0,
		Notes:          "AFTERTRACE_FAIL_STORE sentinel; current engine may return 400/Unknown instead of 503/UNAVAILABLE",
		Representative: true,
	}
}

func crashKillAfter(rng *rand.Rand, importDur time.Duration, smallCorpus bool) time.Duration {
	if smallCorpus || importDur <= 15*time.Second {
		return time.Duration(50+rng.IntN(1500)) * time.Millisecond
	}
	lo := importDur / 20
	if lo < 2*time.Second {
		lo = 2 * time.Second
	}
	hi := importDur * 9 / 10
	const capWait = 5 * time.Minute
	if hi > capWait {
		hi = capWait
	}
	if hi <= lo {
		hi = lo + time.Second
	}
	return lo + time.Duration(rng.Int64N(int64(hi-lo)))
}

func measureCrash(t *testing.T, bin, work, hist, golden string, goldenFP tableFP, importDur time.Duration, p Profile) (Budget, error) {
	rng := rand.New(rand.NewPCG(uint64(p.Seed), 9))
	type trial struct {
		I                   int           `json:"i"`
		KillAfter           time.Duration `json:"kill_after"`
		Spans               int           `json:"spans"`
		ImportedWithoutRows int           `json:"imported_without_rows"`
		MatchGolden         bool          `json:"match_golden"`
	}
	var trials []trial
	pass := true
	for i := 0; i < p.CrashTrials; i++ {
		dir := filepath.Join(work, fmt.Sprintf("crash-%d", i))
		db := filepath.Join(dir, "c.duckdb")
		proc, err := Start(StartOpts{Bin: bin, Dir: dir, HistoryDir: hist, DB: db})
		if err != nil {
			return Budget{}, err
		}
		wait := crashKillAfter(rng, importDur, p.SmallCorpus())
		time.Sleep(wait)
		_ = proc.Kill()
		time.Sleep(200 * time.Millisecond)
		proc2, err := Start(StartOpts{Bin: bin, Dir: filepath.Join(dir, "restart"), HistoryDir: hist, DB: db, ExitAfterWarm: true})
		if err != nil {
			return Budget{}, err
		}
		if err := proc2.WaitExit(p.ImportWait()); err != nil {
			t.Logf("B8 trial %d restart: %v", i, err)
			pass = false
			trials = append(trials, trial{I: i, KillAfter: wait})
			continue
		}
		st, err := store.Open(db)
		if err != nil {
			pass = false
			trials = append(trials, trial{I: i, KillAfter: wait})
			continue
		}
		fp, _ := fingerprintDB(st)
		want, _ := Oracle(st.DB)
		st.Close()
		match := fp.Spans == goldenFP.Spans && fp.Events == goldenFP.Events
		if want.ImportedWithoutRows > 0 || !match {
			pass = false
		}
		trials = append(trials, trial{
			I: i, KillAfter: wait, Spans: fp.Spans,
			ImportedWithoutRows: want.ImportedWithoutRows, MatchGolden: match,
		})
		t.Logf("B8 trial %d kill_after=%s spans=%d imported_without_rows=%d match=%v", i, wait, fp.Spans, want.ImportedWithoutRows, match)
	}
	return Budget{
		ID: "B8", Name: "Resume after SIGKILL", Target: "10 trials: counts match clean import; no file imported without rows",
		Measured:       map[string]any{"trials": trials, "golden": goldenFP},
		Pass:           pass && p.CrashTrials > 0,
		Notes:          fmt.Sprintf("%d trials on the %s corpus; SIGKILL at 5–90%% of golden import (capped at 5m)", p.CrashTrials, FormatSize(p.Size)),
		Corpus:         p.CorpusNote(),
		Representative: !p.SmallCorpus(),
	}, nil
}

func fingerprint(dbPath string) (tableFP, error) {
	st, err := store.Open(dbPath)
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
	return fp, err
}

func copyDB(t *testing.T, src, dst string) string {
	t.Helper()
	for _, suf := range []string{"", ".wal"} {
		b, err := os.ReadFile(src + suf)
		if err != nil {
			if suf == ".wal" {
				continue
			}
			t.Fatalf("copy db: %v", err)
		}
		if err := os.WriteFile(dst+suf, b, 0o644); err != nil {
			t.Fatalf("copy db: %v", err)
		}
	}
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

func mtimeEq(a, b FileSnap) bool {
	if !a.Exists && !b.Exists {
		return true
	}
	return a.Exists == b.Exists && a.Mtime.Equal(b.Mtime)
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

func selfCPU() (float64, error) {
	return CPUSeconds(os.Getpid())
}
