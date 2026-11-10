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
	const batch = 50_000
	for i := 0; i < 40; i++ {
		lo := i*batch + 1
		hi := (i + 1) * batch
		_, err := st.DB.Exec(fmt.Sprintf(`
			INSERT INTO spans
			SELECT
				lpad(gs::VARCHAR, 16, '0'),
				lpad(gs::VARCHAR, 16, '0'),
				NULL,
				'claude_code.llm_request',
				1700000000000000000 + gs,
				1700000000001000000 + gs,
				1.0, false, NULL,
				's' || (gs // 20)::VARCHAR,
				json_object('model','claude-opus-4-5','pad',
					md5(gs::VARCHAR) || md5((gs+1)::VARCHAR) || md5((gs+2)::VARCHAR) ||
					md5((gs+3)::VARCHAR) || md5((gs+4)::VARCHAR) || md5((gs+5)::VARCHAR) ||
					md5((gs+6)::VARCHAR) || md5((gs+7)::VARCHAR) || md5((gs+8)::VARCHAR) ||
					md5((gs+9)::VARCHAR) || md5((gs+10)::VARCHAR) || md5((gs+11)::VARCHAR) ||
					md5((gs+12)::VARCHAR) || md5((gs+13)::VARCHAR) || md5((gs+14)::VARCHAR) ||
					md5((gs+15)::VARCHAR)),
				json_object('service.name','claude-code')
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
		if fi.Size() >= 500*1024*1024 {
			return
		}
	}
	fi, _ := os.Stat(path)
	t.Fatalf("file only %d MB after seed; want >= 500 MB", fi.Size()/1024/1024)
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
	out, err := cmd.CombinedOutput()
	t.Logf("seed child:\n%s", out)
	if err != nil {
		t.Fatalf("seed child: %v", err)
	}
	fi, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Size() < 500*1024*1024 {
		t.Fatalf("seeded db is %d MB, want >= 500 MB", fi.Size()/1024/1024)
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
	if _, err := st.DB.Exec(`SELECT count(*) FROM llm`); err != nil {
		close(stop)
		t.Fatal(err)
	}
	if _, err := st.DB.Exec(`SELECT count(*) FROM turn_roots`); err != nil {
		close(stop)
		t.Fatal(err)
	}
	if _, err := st.Counts(); err != nil {
		close(stop)
		t.Fatal(err)
	}
	if err := st.Reopen(); err != nil {
		close(stop)
		t.Fatal(err)
	}
	if _, err := st.Counts(); err != nil {
		close(stop)
		t.Fatal(err)
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

	const peakCap = 600 * 1024 * 1024
	const steadyCap = 300 * 1024 * 1024
	if peak > peakCap {
		t.Fatalf("engine-start peak RSS %d MB exceeds %d MB on a %d MB DB", peak/1024/1024, peakCap/1024/1024, fi.Size()/1024/1024)
	}
	if steady > steadyCap {
		t.Fatalf("steady RSS %d MB exceeds %d MB on a %d MB DB", steady/1024/1024, steadyCap/1024/1024, fi.Size()/1024/1024)
	}
}
