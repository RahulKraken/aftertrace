package store

import (
	"fmt"
	"os"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

func rssBytes() (uint64, error) {
	if runtime.GOOS != "linux" {
		return 0, fmt.Errorf("rss: %s", runtime.GOOS)
	}
	b, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return 0, err
	}
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "VmRSS:") {
			f := strings.Fields(line)
			if len(f) < 2 {
				break
			}
			kb, err := strconv.ParseUint(f[1], 10, 64)
			return kb * 1024, err
		}
	}
	return 0, fmt.Errorf("no VmRSS")
}

func TestPeakRSSOnSeededDB(t *testing.T) {
	if testing.Short() {
		t.Skip("large seed")
	}
	rss, err := rssBytes()
	if err != nil {
		t.Skip(err)
	}
	before := rss
	st, err := Open(t.TempDir() + "/big.duckdb")
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	// ~80k LLM rows with a 1 KiB pad ≈ a mid-size local store. Views and
	// COUNT(*) are what the old serve path ran before listen, unbounded.
	const n = 80_000
	_, err = st.DB.Exec(fmt.Sprintf(`
		INSERT INTO spans
		SELECT
			lpad(gs::VARCHAR, 16, '0'),
			lpad(gs::VARCHAR, 16, '0'),
			NULL,
			'claude_code.llm_request',
			1700000000000000000,
			1700000000001000000,
			1.0,
			false,
			NULL,
			's' || (gs // 20)::VARCHAR,
			json('{"model":"claude-opus-4-5","pad":"%s"}'),
			json('{"service.name":"claude-code"}')
		FROM generate_series(1, %d) AS t(gs)
	`, strings.Repeat("x", 1024), n))
	if err != nil {
		t.Fatal(err)
	}

	peak := before
	sample := func() {
		runtime.GC()
		if v, err := rssBytes(); err == nil && v > peak {
			peak = v
		}
	}
	sample()
	if _, err := st.DB.Exec(`SELECT count(*) FROM llm`); err != nil {
		t.Fatal(err)
	}
	sample()
	if _, err := st.DB.Exec(`SELECT count(*) FROM turn_roots`); err != nil {
		t.Fatal(err)
	}
	sample()
	if _, err := st.Counts(); err != nil {
		t.Fatal(err)
	}
	sample()
	steady := peak
	if v, err := rssBytes(); err == nil {
		steady = v
	}

	t.Logf("RSS before open %d MB, peak %d MB, steady %d MB (n=%d spans)",
		before/1024/1024, peak/1024/1024, steady/1024/1024, n)
	// 512MB DuckDB cap + Go + mmap of the seeded file. Uncapped DuckDB on a
	// 580MB production DB peaked at 3.5–4.3 GB; this bound must stay well
	// under that.
	const capBytes = 1536 * 1024 * 1024
	if peak > capBytes {
		t.Fatalf("peak RSS %d MB exceeds %d MB cap after seeding %d spans", peak/1024/1024, capBytes/1024/1024, n)
	}
}
