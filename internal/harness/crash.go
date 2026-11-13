//go:build unix

package harness

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/RahulKraken/aftertrace/internal/store"
)

func crashKillPct(i, trials int) int {
	if trials <= 1 {
		return 50
	}
	return 5 + i*85/(trials-1)
}

func dbSize(path string) int64 {
	fi, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return fi.Size()
}

func waitUntilImportPct(t *testing.T, db string, importDur time.Duration, pct int, proc *Proc) (size int64, err error) {
	t.Helper()
	d := importDur * time.Duration(pct) / 100
	if d < 2*time.Second {
		d = 2 * time.Second
	}
	deadline := time.Now().Add(d)
	nextLog := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if proc != nil && proc.Cmd.ProcessState != nil && proc.Cmd.ProcessState.Exited() {
			return dbSize(db), fmt.Errorf("serve exited: %s", proc.tailLog())
		}
		size = dbSize(db)
		if time.Now().After(nextLog) {
			left := time.Until(deadline).Truncate(time.Second)
			t.Logf("B8 wait %s left size=%d", left, size)
			nextLog = time.Now().Add(30 * time.Second)
		}
		time.Sleep(50 * time.Millisecond)
	}
	return dbSize(db), nil
}

func crashedSessionCount(db string) (int, error) {
	st, err := store.OpenReadOnly(db)
	if err != nil {
		return 0, err
	}
	defer st.Close()
	var n int
	err = st.DB.QueryRow(`SELECT count(DISTINCT session_id) FROM spans`).Scan(&n)
	return n, err
}

func measureCrash(t *testing.T, bin, work, hist, golden string, goldenFP tableFP, goldenSize int64, importDur time.Duration, p Profile) (Budget, error) {
	type trial struct {
		I                   int    `json:"i"`
		WantPct             int    `json:"want_pct"`
		SizeAtKill          int64  `json:"size_at_kill"`
		SessionsAtKill      int    `json:"sessions_at_kill"`
		Spans               int    `json:"spans"`
		Events              int    `json:"events"`
		SessionHash         string `json:"session_hash"`
		ImportedWithoutRows int    `json:"imported_without_rows"`
		MatchGolden         bool   `json:"match_golden"`
		Error               string `json:"error,omitempty"`
	}
	var trials []trial
	pass := true
	if goldenSize <= 0 {
		goldenSize = dbSize(golden)
	}
	for i := 0; i < p.CrashTrials; i++ {
		dir := filepath.Join(work, fmt.Sprintf("crash-%d", i))
		_ = os.RemoveAll(dir)
		db := filepath.Join(dir, "c.duckdb")
		proc, err := Start(StartOpts{Bin: bin, Dir: dir, HistoryDir: hist, DB: db})
		if err != nil {
			return Budget{}, err
		}
		if err := proc.WaitReady(2 * time.Minute); err != nil {
			_ = proc.Kill()
			return Budget{}, err
		}
		pct := crashKillPct(i, p.CrashTrials)
		t.Logf("B8 trial %d start kill@%d%% of golden import %s", i, pct, importDur.Truncate(time.Second))
		size, waitErr := waitUntilImportPct(t, db, importDur, pct, proc)
		_ = proc.Kill()
		time.Sleep(200 * time.Millisecond)
		sessAt := 0
		if n, err := crashedSessionCount(db); err == nil {
			sessAt = n
		}
		if waitErr != nil {
			t.Logf("B8 trial %d wait size: %v (killing at %d bytes)", i, waitErr, size)
		}
		proc2, err := Start(StartOpts{Bin: bin, Dir: filepath.Join(dir, "restart"), HistoryDir: hist, DB: db, ExitAfterWarm: true})
		if err != nil {
			return Budget{}, err
		}
		if err := proc2.WaitExit(p.ImportWait()); err != nil {
			t.Logf("B8 trial %d restart: %v", i, err)
			pass = false
			trials = append(trials, trial{I: i, WantPct: pct, SizeAtKill: size, SessionsAtKill: sessAt, Error: err.Error()})
			continue
		}
		fp, err := fingerprint(db)
		if err != nil {
			pass = false
			trials = append(trials, trial{I: i, WantPct: pct, SizeAtKill: size, SessionsAtKill: sessAt, Error: err.Error()})
			continue
		}
		match := fpEqual(fp, goldenFP)
		if fp.ImportedWithoutRows > 0 || !match {
			pass = false
		}
		trials = append(trials, trial{
			I: i, WantPct: pct, SizeAtKill: size, SessionsAtKill: sessAt,
			Spans: fp.Spans, Events: fp.Events, SessionHash: fp.SessionHash,
			ImportedWithoutRows: fp.ImportedWithoutRows, MatchGolden: match,
		})
		t.Logf("B8 trial %d kill@%d%% size=%d sessions=%d spans=%d events=%d imported_without_rows=%d match=%v", i, pct, size, sessAt, fp.Spans, fp.Events, fp.ImportedWithoutRows, match)
	}
	return Budget{
		ID: "B8", Name: "Resume after SIGKILL", Target: "10 trials: counts, cost, session hash match clean import; no file imported without rows",
		Measured:       map[string]any{"trials": trials, "golden": goldenFP, "golden_bytes": goldenSize},
		Pass:           pass && p.CrashTrials > 0,
		Notes:          fmt.Sprintf("%d trials on the %s corpus; SIGKILL at 5–90%% of golden import (%s); size and sessions recorded at kill", p.CrashTrials, FormatSize(p.Size), importDur.Truncate(time.Second)),
		Corpus:         p.CorpusNote(),
		Representative: !p.SmallCorpus(),
	}, nil
}
