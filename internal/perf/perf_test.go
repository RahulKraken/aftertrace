package perf

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"runtime/pprof"
	"sort"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/RahulKraken/aftertrace/internal/api"
	"github.com/RahulKraken/aftertrace/internal/store"
)

func TestBudgetsOnRealisticSeed(t *testing.T) {
	if testing.Short() {
		t.Skip("perf")
	}
	if os.Getenv("AFTERTRACE_PERF") != "1" {
		t.Skip("set AFTERTRACE_PERF=1")
	}
	outDir := os.Getenv("AFTERTRACE_PERF_OUT")
	if outDir == "" {
		outDir = t.TempDir()
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		t.Fatal(err)
	}

	dbPath := filepath.Join(t.TempDir(), "perf.duckdb")
	st, err := store.Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	spec := Realistic()
	t0 := time.Now()
	if err := Seed(st, spec); err != nil {
		t.Fatal(err)
	}
	t.Logf("seed 92k in %s", time.Since(t0).Truncate(time.Millisecond))
	if err := st.Reopen(); err != nil {
		t.Fatal(err)
	}
	dbBytes := duckdbSize(dbPath)
	t.Logf("db file %d MB", dbBytes/(1024*1024))
	if dbBytes > 150*1024*1024 {
		t.Errorf("db file %d MB for 92k spans, want <150MB (580MB was leftover --store-content)", dbBytes/(1024*1024))
	}
	var n int
	if err := st.DB.QueryRow(`SELECT count(*) FROM spans`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n < 92000 {
		t.Fatalf("spans=%d want >= 92000", n)
	}
	var turns, sessions int
	_ = st.DB.QueryRow(`SELECT count(*) FROM trace_roots`).Scan(&turns)
	_ = st.DB.QueryRow(`SELECT count(*) FROM session_stats`).Scan(&sessions)
	t.Logf("rollups turns=%d sessions=%d spans=%d", turns, sessions, n)

	runtime.GC()
	debug.FreeOSMemory()
	h := api.New(st, nil)
	srv := httptest.NewServer(h)
	defer srv.Close()

	cpuFile, err := os.Create(filepath.Join(outDir, "cpu.pprof"))
	if err != nil {
		t.Fatal(err)
	}
	if err := pprof.StartCPUProfile(cpuFile); err != nil {
		t.Fatal(err)
	}
	defer func() {
		pprof.StopCPUProfile()
		cpuFile.Close()
		writeProfiles(t, outDir)
	}()

	writeExplain(t, st, filepath.Join(outDir, "explain.txt"))

	cold := time.Now()
	mustOK(t, srv.URL+"/api/health")
	mustOK(t, srv.URL+"/api/glance")
	coldMS := time.Since(cold).Milliseconds()
	t.Logf("cold health+glance %d ms", coldMS)
	if coldMS > 1000 {
		t.Errorf("cold start to first data %d ms, want < 1000", coldMS)
	}

	endpoints := []string{"/api/health", "/api/glance", "/api/status", "/api/overview", "/api/sessions", "/api/findings"}
	lat := map[string][]time.Duration{}
	var latMu sync.Mutex
	record := func(p string, d time.Duration) {
		latMu.Lock()
		lat[p] = append(lat[p], d)
		latMu.Unlock()
	}
	for i := 0; i < 40; i++ {
		for _, p := range endpoints {
			d, err := hit(srv.URL + p)
			if err != nil {
				t.Fatalf("%s: %v", p, err)
			}
			record(p, d)
		}
	}

	// Mimic the desktop: tray health 1s + glance 45s; open window polls without overlap.
	loadFor := 90 * time.Second
	if os.Getenv("AFTERTRACE_PERF_SOAK") == "1" {
		loadFor = 10 * time.Minute
	}
	stop := make(chan struct{})
	errCh := make(chan error, 8)
	go func() {
		tck := time.NewTicker(time.Second)
		defer tck.Stop()
		for {
			select {
			case <-stop:
				return
			case <-tck.C:
				d, err := hit(srv.URL + "/api/health")
				if err != nil {
					errCh <- err
					return
				}
				record("/api/health", d)
			}
		}
	}()
	go func() {
		tck := time.NewTicker(45 * time.Second)
		defer tck.Stop()
		d, err := hit(srv.URL + "/api/glance")
		if err != nil {
			errCh <- err
			return
		}
		record("/api/glance", d)
		for {
			select {
			case <-stop:
				return
			case <-tck.C:
				d, err := hit(srv.URL + "/api/glance")
				if err != nil {
					errCh <- err
					return
				}
				record("/api/glance", d)
			}
		}
	}()
	go func() {
		paths := []string{"/api/overview", "/api/sessions", "/api/status", "/api/findings", "/api/cost?dim=model"}
		for {
			select {
			case <-stop:
				return
			default:
			}
			for _, p := range paths {
				d, err := hit(srv.URL + p)
				if err != nil {
					errCh <- err
					return
				}
				record(p, d)
			}
			time.Sleep(4 * time.Second)
		}
	}()

	peak := rssOrZero()
	cpu0 := cpuTime()
	wall0 := time.Now()
	lastCPU, lastWall := cpu0, wall0
	rssF, _ := os.Create(filepath.Join(outDir, "rss-cpu.csv"))
	if rssF != nil {
		fmt.Fprintln(rssF, "seconds,rss_mb,cpu_pct")
	}
	sample := time.NewTicker(200 * time.Millisecond)
	endLoad := time.Now().Add(loadFor)
	for time.Now().Before(endLoad) {
		select {
		case err := <-errCh:
			close(stop)
			t.Fatal(err)
		case <-sample.C:
			if v := rssOrZero(); v > peak {
				peak = v
			}
			now := time.Now()
			cpu := cpuTime()
			dt := now.Sub(lastWall).Seconds()
			var pct float64
			if dt > 0 {
				pct = (cpu - lastCPU) / dt * 100
			}
			if rssF != nil {
				fmt.Fprintf(rssF, "%.2f,%.1f,%.2f\n", now.Sub(wall0).Seconds(), float64(rssOrZero())/(1024*1024), pct)
			}
			lastCPU, lastWall = cpu, now
		}
	}
	sample.Stop()
	if rssF != nil {
		rssF.Close()
	}
	close(stop)
	time.Sleep(200 * time.Millisecond)
	loadCPU := (cpuTime() - cpu0) / time.Since(wall0).Seconds() * 100

	r1 := cpuTime()
	idleWall := 20 * time.Second
	time.Sleep(idleWall)
	r2 := cpuTime()
	idlePct := (r2 - r1) / idleWall.Seconds() * 100

	runtime.GC()
	debug.FreeOSMemory()
	time.Sleep(200 * time.Millisecond)
	steady := rssOrZero()

	report := map[string]any{
		"seed_spans": n, "turns": turns, "sessions": sessions,
		"cold_ms": coldMS, "peak_rss_mb": peak / (1024 * 1024), "steady_rss_mb": steady / (1024 * 1024),
		"idle_cpu_pct": idlePct, "open_window_cpu_pct": loadCPU, "load_s": loadFor.Seconds(),
		"db_mb":      dbBytes / (1024 * 1024),
		"latency_ms": map[string]any{},
	}
	t.Logf("RSS peak %d MB steady %d MB idle CPU %.2f%% window-open CPU %.2f%% db %d MB",
		peak/(1024*1024), steady/(1024*1024), idlePct, loadCPU, dbBytes/(1024*1024))
	if loadCPU > 5 {
		t.Errorf("window-open CPU %.2f%% of one core, want <5%%", loadCPU)
	}
	hard := 300 * time.Millisecond
	want := 100 * time.Millisecond
	latMu.Lock()
	for _, p := range []string{"/api/overview", "/api/sessions", "/api/findings", "/api/status", "/api/glance", "/api/health"} {
		p50, p95 := pct(lat[p], 50), pct(lat[p], 95)
		t.Logf("%s n=%d p50=%s p95=%s", p, len(lat[p]), p50.Truncate(time.Microsecond), p95.Truncate(time.Microsecond))
		report["latency_ms"].(map[string]any)[p] = map[string]any{"p50_ms": p50.Seconds() * 1000, "p95_ms": p95.Seconds() * 1000, "n": len(lat[p])}
		if p95 > hard {
			t.Errorf("%s p95 %s exceeds hard 300ms", p, p95)
		} else if p95 > want {
			t.Logf("WARN %s p95 %s exceeds 100ms target (under 300ms cap)", p, p95)
		}
	}
	latMu.Unlock()
	if peak > 500*1024*1024 {
		t.Errorf("peak RSS %d MB exceeds 500 MB", peak/(1024*1024))
	}
	if steady > 200*1024*1024 {
		t.Errorf("steady RSS %d MB exceeds 200 MB", steady/(1024*1024))
	}
	if idlePct > 5 {
		t.Errorf("idle CPU %.2f%% of one core, want <1%% (fail at 5%%)", idlePct)
	} else if idlePct > 1 {
		t.Logf("WARN idle CPU %.2f%% (target <1%%)", idlePct)
	}

	b, _ := json.MarshalIndent(report, "", "  ")
	_ = os.WriteFile(filepath.Join(outDir, "metrics.json"), b, 0o644)

	srv.Close()
	_ = st.Close()
	runtime.GC()
	debug.FreeOSMemory()

	// 5× seed in a fresh store: peak RSS and p95 only.
	st2, err := store.Open(filepath.Join(t.TempDir(), "perf5x.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	defer st2.Close()
	t1 := time.Now()
	if err := Seed(st2, Large()); err != nil {
		t.Fatal(err)
	}
	t.Logf("seed 500k in %s", time.Since(t1).Truncate(time.Millisecond))
	if err := st2.Reopen(); err != nil {
		t.Fatal(err)
	}
	runtime.GC()
	debug.FreeOSMemory()
	h2 := api.New(st2, nil)
	srv2 := httptest.NewServer(h2)
	defer srv2.Close()
	peak2 := rssOrZero()
	var lat5 []time.Duration
	for i := 0; i < 20; i++ {
		for _, p := range []string{"/api/overview", "/api/sessions", "/api/status", "/api/findings", "/api/glance"} {
			d, err := hit(srv2.URL + p)
			if err != nil {
				t.Fatalf("5x %s: %v", p, err)
			}
			lat5 = append(lat5, d)
			if v := rssOrZero(); v > peak2 {
				peak2 = v
			}
		}
	}
	p95x := pct(lat5, 95)
	t.Logf("500k p95 %s peak RSS %d MB", p95x, peak2/(1024*1024))
	if p95x > 300*time.Millisecond {
		t.Errorf("500k p95 %s exceeds 300ms", p95x)
	}
	if peak2 > 500*1024*1024 {
		t.Errorf("500k peak RSS %d MB exceeds 500 MB", peak2/(1024*1024))
	}
}

func hit(url string) (time.Duration, error) {
	t0 := time.Now()
	res, err := http.Get(url)
	d := time.Since(t0)
	if err != nil {
		return d, err
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, res.Body)
	if res.StatusCode != 200 {
		return d, fmt.Errorf("%s -> %d", url, res.StatusCode)
	}
	return d, nil
}

func mustOK(t *testing.T, url string) {
	t.Helper()
	if _, err := hit(url); err != nil {
		t.Fatal(err)
	}
}

func pct(ds []time.Duration, p int) time.Duration {
	if len(ds) == 0 {
		return 0
	}
	cp := append([]time.Duration(nil), ds...)
	sort.Slice(cp, func(i, j int) bool { return cp[i] < cp[j] })
	i := (p * (len(cp) - 1)) / 100
	return cp[i]
}

func rssOrZero() uint64 {
	if runtime.GOOS != "linux" {
		var r syscall.Rusage
		_ = syscall.Getrusage(syscall.RUSAGE_SELF, &r)
		if r.Maxrss > 0 {
			if runtime.GOOS == "darwin" {
				return uint64(r.Maxrss)
			}
			return uint64(r.Maxrss) * 1024
		}
		return 0
	}
	b, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return 0
	}
	var kb uint64
	for _, line := range splitLines(b) {
		if len(line) > 6 && string(line[:6]) == "VmRSS:" {
			fmt.Sscanf(string(line[6:]), "%d", &kb)
			return kb * 1024
		}
	}
	return 0
}

func cpuTime() float64 {
	var r syscall.Rusage
	_ = syscall.Getrusage(syscall.RUSAGE_SELF, &r)
	return float64(r.Utime.Nano()+r.Stime.Nano()) / 1e9
}

func splitLines(b []byte) [][]byte {
	var out [][]byte
	start := 0
	for i, c := range b {
		if c == '\n' {
			out = append(out, b[start:i])
			start = i + 1
		}
	}
	if start < len(b) {
		out = append(out, b[start:])
	}
	return out
}

func duckdbSize(path string) int64 {
	var n int64
	for _, p := range []string{path, path + ".wal"} {
		fi, err := os.Stat(p)
		if err == nil {
			n += fi.Size()
		}
	}
	return n
}

func writeProfiles(t *testing.T, dir string) {
	t.Helper()
	for _, name := range []string{"heap", "allocs", "goroutine"} {
		f, err := os.Create(filepath.Join(dir, name+".pprof"))
		if err != nil {
			t.Log(err)
			continue
		}
		_ = pprof.Lookup(name).WriteTo(f, 0)
		f.Close()
	}
}

func writeExplain(t *testing.T, st *store.Store, path string) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Log(err)
		return
	}
	defer f.Close()
	queries := []string{
		`EXPLAIN ANALYZE SELECT * FROM session_stats ORDER BY start_ns DESC`,
		`EXPLAIN ANALYZE SELECT * FROM trace_roots WHERE start_ns >= 0`,
		`EXPLAIN ANALYZE SELECT * FROM day_stats`,
		`EXPLAIN ANALYZE SELECT coalesce(sum(sessions),0), coalesce(sum(turns),0), coalesce(sum(turn_ms),0), coalesce(sum(cost_usd),0) FROM day_stats`,
		`EXPLAIN ANALYZE SELECT * FROM source_stats`,
		`EXPLAIN ANALYZE SELECT count(*) FROM trace_roots WHERE in_progress`,
		`EXPLAIN ANALYZE SELECT session_id, coalesce(repo,''), start_ns, end_ns, history FROM session_stats`,
	}
	for _, q := range queries {
		fmt.Fprintln(f, "==", q)
		rows, err := st.DB.Query(q)
		if err != nil {
			fmt.Fprintln(f, err)
			continue
		}
		cols, _ := rows.Columns()
		for rows.Next() {
			vals := make([]any, len(cols))
			ptrs := make([]any, len(cols))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			_ = rows.Scan(ptrs...)
			fmt.Fprintln(f, vals)
		}
		rows.Close()
		fmt.Fprintln(f)
	}
}
