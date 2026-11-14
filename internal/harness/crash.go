//go:build unix

package harness

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/RahulKraken/aftertrace/internal/store"
)

var errKillWaitTimeout = errors.New("kill wait timed out")

// crashKillSessions returns how many distinct ingested sessions to wait for
// before SIGKILL. Spread 5–90% of the golden session count, never the full
// count: Import() includes post-ingest rollup, so a wall-time percentage can
// fire after all sessions are already in (nightly 43478795531 trials 6–9).
func crashKillSessions(i, trials, total int) int {
	if total <= 1 {
		return 1
	}
	pct := 50
	if trials > 1 {
		pct = 5 + i*85/(trials-1)
	}
	n := pct * total / 100
	if n < 1 {
		n = 1
	}
	if n >= total {
		n = total - 1
	}
	return n
}

func dbSize(path string) int64 {
	fi, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return fi.Size()
}

func waitUntilSessions(t *testing.T, want int, deadline time.Time, proc *Proc) (got int, err error) {
	t.Helper()
	nextLog := time.Now().Add(30 * time.Second)
	for {
		if proc != nil && proc.Cmd.ProcessState != nil && proc.Cmd.ProcessState.Exited() {
			return got, fmt.Errorf("serve exited: %s", proc.tailLog())
		}
		if proc != nil && proc.UI != "" {
			if n, qerr := liveSessionCount(proc.UI); qerr == nil {
				got = n
				if n >= want {
					return n, nil
				}
			}
		}
		if !deadline.IsZero() && time.Now().After(deadline) {
			return got, fmt.Errorf("%w: waiting for %d sessions (last %d)", errKillWaitTimeout, want, got)
		}
		if time.Now().After(nextLog) {
			left := time.Duration(0)
			if !deadline.IsZero() {
				left = time.Until(deadline).Truncate(time.Second)
			}
			t.Logf("B8 wait sessions=%d want=%d left=%s", got, want, left)
			nextLog = time.Now().Add(30 * time.Second)
		}
		time.Sleep(200 * time.Millisecond)
	}
}

func liveSessionCount(ui string) (int, error) {
	c := &http.Client{Timeout: 2 * time.Second}
	payload := `{"sql":"SELECT count(DISTINCT session_id) FROM spans"}`
	res, err := c.Post("http://"+ui+"/api/sql", "application/json", strings.NewReader(payload))
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	if res.StatusCode != 200 {
		return 0, fmt.Errorf("sql %d: %s", res.StatusCode, trim(b, 200))
	}
	var out struct {
		Rows [][]any `json:"rows"`
	}
	if err := json.Unmarshal(b, &out); err != nil {
		return 0, err
	}
	if len(out.Rows) == 0 || len(out.Rows[0]) == 0 {
		return 0, fmt.Errorf("empty session count")
	}
	switch v := out.Rows[0][0].(type) {
	case float64:
		return int(v), nil
	case json.Number:
		n, err := v.Int64()
		return int(n), err
	case string:
		var n int
		_, err := fmt.Sscanf(v, "%d", &n)
		return n, err
	default:
		return 0, fmt.Errorf("session count %T %v", v, v)
	}
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
		WantSessions        int    `json:"want_sessions"`
		SizeAtKill          int64  `json:"size_at_kill"`
		SessionsAtKill      int    `json:"sessions_at_kill"`
		Spans               int    `json:"spans"`
		Events              int    `json:"events"`
		SessionHash         string `json:"session_hash"`
		ImportedWithoutRows int    `json:"imported_without_rows"`
		MatchGolden         bool   `json:"match_golden"`
		Invalid             bool   `json:"invalid,omitempty"`
		Error               string `json:"error,omitempty"`
	}
	var trials []trial
	if goldenSize <= 0 {
		goldenSize = dbSize(golden)
	}
	goldenSessions := p.Sessions
	if n, err := crashedSessionCount(golden); err == nil && n > 0 {
		goldenSessions = n
	}
	matched, valid, invalid := 0, 0, 0
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
		want := crashKillSessions(i, p.CrashTrials, goldenSessions)
		t.Logf("B8 trial %d start kill@%d/%d sessions (golden import %s)", i, want, goldenSessions, importDur.Truncate(time.Second))
		deadline := time.Now().Add(p.ImportWait())
		sessLive, waitErr := waitUntilSessions(t, want, deadline, proc)
		_ = proc.Kill()
		time.Sleep(200 * time.Millisecond)
		size := dbSize(db)
		sessAt := sessLive
		if n, err := crashedSessionCount(db); err == nil {
			sessAt = n
		}
		if waitErr != nil {
			t.Logf("B8 trial %d wait sessions: %v (killing at %d sessions, %d bytes)", i, waitErr, sessAt, size)
		}
		if errors.Is(waitErr, errKillWaitTimeout) {
			invalid++
			trials = append(trials, trial{
				I: i, WantSessions: want, SizeAtKill: size, SessionsAtKill: sessAt,
				Invalid: true, Error: waitErr.Error(),
			})
			t.Logf("B8 trial %d INVALID: kill wait timed out at %d/%d sessions", i, sessAt, want)
			continue
		}
		if sessAt >= goldenSessions {
			invalid++
			trials = append(trials, trial{
				I: i, WantSessions: want, SizeAtKill: size, SessionsAtKill: sessAt,
				Invalid: true, Error: fmt.Sprintf("killed after ingest finished (%d/%d sessions)", sessAt, goldenSessions),
			})
			t.Logf("B8 trial %d INVALID: killed after ingest (%d/%d sessions)", i, sessAt, goldenSessions)
			continue
		}
		proc2, err := Start(StartOpts{Bin: bin, Dir: filepath.Join(dir, "restart"), HistoryDir: hist, DB: db, ExitAfterWarm: true})
		if err != nil {
			return Budget{}, err
		}
		if err := proc2.WaitExit(p.ImportWait()); err != nil {
			t.Logf("B8 trial %d restart: %v", i, err)
			valid++
			trials = append(trials, trial{I: i, WantSessions: want, SizeAtKill: size, SessionsAtKill: sessAt, Error: err.Error()})
			continue
		}
		fp, err := fingerprint(db)
		if err != nil {
			valid++
			trials = append(trials, trial{I: i, WantSessions: want, SizeAtKill: size, SessionsAtKill: sessAt, Error: err.Error()})
			continue
		}
		match := fpEqual(fp, goldenFP) && fp.ImportedWithoutRows == 0
		valid++
		if match {
			matched++
		}
		trials = append(trials, trial{
			I: i, WantSessions: want, SizeAtKill: size, SessionsAtKill: sessAt,
			Spans: fp.Spans, Events: fp.Events, SessionHash: fp.SessionHash,
			ImportedWithoutRows: fp.ImportedWithoutRows, MatchGolden: match,
		})
		t.Logf("B8 trial %d kill@%d sessions size=%d sessions=%d spans=%d events=%d imported_without_rows=%d match=%v", i, want, size, sessAt, fp.Spans, fp.Events, fp.ImportedWithoutRows, match)
	}
	need := 8
	if p.CrashTrials < need {
		need = p.CrashTrials
	}
	pass := valid >= need && matched == valid && need > 0
	b := Budget{
		ID: "B8", Name: "Resume after SIGKILL", Target: "≥8 valid mid-import SIGKILL trials, all matched; no imported-without-rows",
		Measured: map[string]any{
			"matched": matched, "valid": valid, "invalid": invalid, "need_valid": need,
			"trials": trials, "golden": goldenFP, "golden_bytes": goldenSize,
			"golden_sessions": goldenSessions,
		},
		Pass:           pass,
		Notes:          fmt.Sprintf("%d/%d matched/valid; %d invalid; need ≥%d valid; SIGKILL after N ingested sessions (5–90%% of %d)", matched, valid, invalid, need, goldenSessions),
		Corpus:         p.CorpusNote(),
		Representative: !p.SmallCorpus(),
	}
	if valid < need {
		b.Pass = false
		if valid == 0 {
			b.Invalid = true
			b.Notes += "; no valid mid-import trials"
		} else {
			b.Notes += fmt.Sprintf("; fewer than %d valid trials", need)
		}
	}
	return b, nil
}
