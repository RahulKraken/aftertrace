package store

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"testing"
	"time"
)

func rssBytes() (uint64, error) {
	if runtime.GOOS != "linux" {
		return 0, fmt.Errorf("rss: %s", runtime.GOOS)
	}
	b, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return 0, err
	}
	var total uint64
	for _, line := range strings.Split(string(b), "\n") {
		f := strings.Fields(line)
		if len(f) < 2 {
			continue
		}
		if strings.HasPrefix(line, "VmRSS:") {
			kb, err := strconv.ParseUint(f[1], 10, 64)
			if err != nil {
				return 0, err
			}
			total = kb * 1024
		}
	}
	if total == 0 {
		return 0, fmt.Errorf("no VmRSS")
	}
	return total, nil
}

func rssParts() (anon, file, total uint64) {
	b, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return 0, 0, 0
	}
	for _, line := range strings.Split(string(b), "\n") {
		f := strings.Fields(line)
		if len(f) < 2 {
			continue
		}
		kb, _ := strconv.ParseUint(f[1], 10, 64)
		switch {
		case strings.HasPrefix(line, "VmRSS:"):
			total = kb * 1024
		case strings.HasPrefix(line, "RssAnon:"):
			anon = kb * 1024
		case strings.HasPrefix(line, "RssFile:"):
			file = kb * 1024
		}
	}
	return
}

func seedLargeDB(t *testing.T, path string) {
	t.Helper()
	st, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	// Rahul's file is ~689 MB / ~102k spans with leftover --store-content (~6.5 KB/span).
	// repeat('p', N) and short unique strings compress; a 7 KB unique blob does not.
	// Fat leftover content on the first 52k rows, tiny attrs after, so 100k spans land near 700 MB.
	const batch = 400
	var hi int
	for i := 0; i < 260; i++ {
		lo := i*batch + 1
		hi = (i + 1) * batch
		_, err := st.DB.Exec(fmt.Sprintf(`
			INSERT INTO spans
			SELECT
				'tr-' || gs,
				'sp-' || gs,
				CASE WHEN gs %% 40 = 1 THEN NULL ELSE 'sp-' || (((gs-1) // 40) * 40 + 1) END,
				CASE WHEN gs %% 40 = 1 THEN 'claude_code.interaction'
				     WHEN gs %% 8 = 0 THEN 'claude_code.llm_request'
				     ELSE 'claude_code.tool' END,
				1700000000000000000 + gs * 1000,
				1700000000001000000 + gs * 1000,
				1.0, false, NULL,
				'sess-' || (gs // 80),
				json_object(
					'prompt', CASE WHEN gs <= 52000
						THEN array_to_string(list_transform(range(0, 220), i -> md5((gs * 256 + i)::VARCHAR)), '')
						ELSE md5(gs::VARCHAR) END,
					'model', 'claude-opus-4-5',
					'request_id', 'req-' || gs,
					'input_tokens', 120,
					'output_tokens', 40,
					'cost_usd', 0.01
				),
				json_object('service.name','claude-code','aftertrace.source','history')
			FROM generate_series(%d, %d) AS t(gs)
		`, lo, hi))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := st.DB.Exec(`CHECKPOINT`); err != nil {
			t.Fatal(err)
		}
		fi, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("seeded %d spans, file %d MB", hi, fi.Size()/1024/1024)
		if fi.Size() >= 680*1024*1024 && hi >= 100_000 {
			return
		}
	}
	fi, _ := os.Stat(path)
	t.Fatalf("file only %d MB / %d spans after seed; want >= 680 MB and 100k spans", fi.Size()/1024/1024, hi)
}

func TestPeakRSSOnSeededDB(t *testing.T) {
	if testing.Short() {
		t.Skip("large seed")
	}
	if os.Getenv("AFTERTRACE_RSS_TEST") != "1" {
		t.Skip("set AFTERTRACE_RSS_TEST=1 (dedicated CI step, not -race)")
	}
	if _, err := rssBytes(); err != nil {
		t.Skip(err)
	}

	if os.Getenv("AFTERTRACE_RSS_SEED") == "1" {
		path := os.Getenv("AFTERTRACE_RSS_DB")
		if path == "" {
			t.Fatal("AFTERTRACE_RSS_DB required")
		}
		seedLargeDB(t, path)
		return
	}

	dir := t.TempDir()
	path := filepath.Join(dir, "big.duckdb")
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(exe, "-test.run=^TestPeakRSSOnSeededDB$", "-test.count=1", "-test.v")
	cmd.Env = append(os.Environ(), "AFTERTRACE_RSS_SEED=1", "AFTERTRACE_RSS_DB="+path)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		t.Fatalf("seed child: %v", err)
	}
	fi, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Size() < 680*1024*1024 {
		t.Fatalf("seeded db is %d MB, want >= 680 MB", fi.Size()/1024/1024)
	}

	runtime.GC()
	debug.FreeOSMemory()
	time.Sleep(200 * time.Millisecond)
	before, err := rssBytes()
	if err != nil {
		t.Fatal(err)
	}
	peak := before
	sample := func() {
		if v, err := rssBytes(); err == nil && v > peak {
			peak = v
		}
	}
	stop := make(chan struct{})
	go func() {
		t := time.NewTicker(20 * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-stop:
				return
			case <-t.C:
				sample()
			}
		}
	}()

	st, err := Open(path)
	if err != nil {
		close(stop)
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Warm(true); err != nil {
		close(stop)
		t.Fatal(err)
	}
	if _, err := st.DB.Exec(`SELECT count(*) FROM llm`); err != nil {
		close(stop)
		t.Fatal(err)
	}
	if _, err := st.DB.Exec(`SELECT count(*) FROM turn_roots`); err != nil {
		close(stop)
		t.Fatal(err)
	}
	c, err := st.Counts()
	if err != nil {
		close(stop)
		t.Fatal(err)
	}
	if c.Spans < 100_000 {
		close(stop)
		t.Fatalf("spans=%d, want >= 100000", c.Spans)
	}
	close(stop)
	time.Sleep(500 * time.Millisecond)
	runtime.GC()
	debug.FreeOSMemory()
	steady, err := rssBytes()
	if err != nil {
		t.Fatal(err)
	}
	anon, fileRSS, _ := rssParts()
	t.Logf("file %d MB; RSS before open %d MB, peak %d MB, steady %d MB (anon %d file %d)",
		fi.Size()/1024/1024, before/1024/1024, peak/1024/1024, steady/1024/1024, anon/1024/1024, fileRSS/1024/1024)

	const peakCap = 450 * 1024 * 1024
	const steadyCap = 200 * 1024 * 1024
	if peak > peakCap {
		t.Fatalf("engine-start peak RSS %d MB exceeds %d MB on a %d MB / %d-span DB", peak/1024/1024, peakCap/1024/1024, fi.Size()/1024/1024, c.Spans)
	}
	if steady > steadyCap {
		t.Fatalf("steady RSS %d MB exceeds %d MB on a %d MB / %d-span DB", steady/1024/1024, steadyCap/1024/1024, fi.Size()/1024/1024, c.Spans)
	}
}
