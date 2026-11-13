//go:build unix

package harness

import (
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"testing"
	"time"
)

func TestClosedWindowValid(t *testing.T) {
	idle := 20 * time.Second
	if why, ok := closedWindowValid(ScenarioCPU{WallSeconds: 20, Hits: map[string]int64{"supervisor_health": 20}}, idle); !ok {
		t.Fatalf("want valid, got %s", why)
	}
	if _, ok := closedWindowValid(ScenarioCPU{WallSeconds: 44.7, Hits: map[string]int64{"supervisor_health": 2}}, idle); ok {
		t.Fatal("44.7s / 2 hits must be invalid")
	}
}

func TestStopProcessGroupDoesNotBlock(t *testing.T) {
	if os.Getenv("HARNESS_IGNORE_SIGNALS") == "1" {
		signal.Ignore(syscall.SIGINT, syscall.SIGTERM)
		time.Sleep(60 * time.Second)
		return
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestStopProcessGroupDoesNotBlock$")
	cmd.Env = append(os.Environ(), "HARNESS_IGNORE_SIGNALS=1")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	time.Sleep(200 * time.Millisecond)
	t0 := time.Now()
	killed := stopProcessGroup(cmd.Process, 200*time.Millisecond)
	elapsed := time.Since(t0)
	if elapsed > 3*time.Second {
		t.Fatalf("stopProcessGroup blocked %s", elapsed)
	}
	if !killed {
		t.Fatal("wanted SIGKILL after ignored SIGINT")
	}
}

func TestStopSudoChildKillsRootProcess(t *testing.T) {
	if os.Getenv("HARNESS_SUDO_IGNORE_SIGNALS") == "1" {
		signal.Ignore(syscall.SIGINT, syscall.SIGTERM)
		time.Sleep(60 * time.Second)
		return
	}
	if err := exec.Command("sudo", "-n", "true").Run(); err != nil {
		t.Skip("passwordless sudo not available")
	}
	cmd := exec.Command("sudo", "-n", "env", "HARNESS_SUDO_IGNORE_SIGNALS=1", os.Args[0], "-test.run=^TestStopSudoChildKillsRootProcess$")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	sudoPID := cmd.Process.Pid
	child := waitNamedChild(sudoPID, filepath.Base(os.Args[0]), 3*time.Second)
	if child <= 0 {
		_ = exec.Command("sudo", "-n", "kill", "-9", "-"+strconv.Itoa(sudoPID)).Run()
		waitProc(cmd.Process, 2*time.Second)
		t.Fatal("no root child of sudo")
	}
	t.Logf("sudo pid %d root child %d", sudoPID, child)
	t0 := time.Now()
	killed := stopRootPID(child, 200*time.Millisecond)
	elapsed := time.Since(t0)
	if elapsed > 3*time.Second {
		t.Fatalf("stopRootPID blocked %s", elapsed)
	}
	if pidAlive(child) {
		_ = exec.Command("sudo", "-n", "kill", "-9", strconv.Itoa(child)).Run()
		t.Fatalf("root child %d still alive after sudo kill (killed=%v)", child, killed)
	}
	if cmd.Process != nil && pidAlive(cmd.Process.Pid) {
		_ = exec.Command("sudo", "-n", "kill", "-9", strconv.Itoa(cmd.Process.Pid)).Run()
	}
	waitProc(cmd.Process, 2*time.Second)
}

func TestCrashKillSessions(t *testing.T) {
	if g := crashKillSessions(0, 10, 800); g != 40 {
		t.Fatalf("first %d", g)
	}
	if g := crashKillSessions(9, 10, 800); g != 720 {
		t.Fatalf("last %d", g)
	}
	for i := 0; i < 10; i++ {
		n := crashKillSessions(i, 10, 800)
		if n < 1 || n >= 800 {
			t.Fatalf("trial %d sessions %d not mid-import", i, n)
		}
	}
}

func TestCopyDBStreamsAndDropsWAL(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.duckdb")
	dst := filepath.Join(dir, "dst.duckdb")
	if err := os.WriteFile(src, []byte("db-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(src+".wal", []byte("new-wal"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dst, []byte("stale"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dst+".wal", []byte("stale-wal"), 0o644); err != nil {
		t.Fatal(err)
	}
	copyDB(t, src, dst)
	got, err := os.ReadFile(dst)
	if err != nil || string(got) != "db-bytes" {
		t.Fatalf("dst db %q %v", got, err)
	}
	wal, err := os.ReadFile(dst + ".wal")
	if err != nil || string(wal) != "new-wal" {
		t.Fatalf("dst wal %q %v", wal, err)
	}
	removeDB(dst)
	if _, err := os.Stat(dst); !os.IsNotExist(err) {
		t.Fatalf("dst still there: %v", err)
	}
	if _, err := os.Stat(dst + ".wal"); !os.IsNotExist(err) {
		t.Fatalf("wal still there: %v", err)
	}
}

func TestScaleBudgets(t *testing.T) {
	if os.Getenv("AFTERTRACE_HARNESS") != "1" {
		t.Skip("set AFTERTRACE_HARNESS=1 to run the report-only scale harness")
	}
	p := ProfileFromEnv()
	reportDir := t.TempDir()
	work := reportDir
	if out := os.Getenv("AFTERTRACE_HARNESS_OUT"); out != "" {
		reportDir = out
		if err := os.MkdirAll(reportDir, 0o755); err != nil {
			t.Fatal(err)
		}
		work = filepath.Join(out, "run-"+time.Now().UTC().Format("20060102T150405Z"))
		if err := os.MkdirAll(work, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	bin, err := BuildBin(work)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("profile %s corpus %s bin %s work %s", p.Name, p.CorpusNote(), bin, work)
	rep, err := Run(t, p, bin, work)
	if err != nil {
		t.Fatalf("harness infrastructure: %v", err)
	}
	md := rep.Markdown()
	t.Log("\n" + md)
	writeReport := func(dir string) {
		t.Helper()
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := rep.Write(filepath.Join(dir, "budgets.json")); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "budgets.md"), []byte(md), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	writeReport(work)
	writeReport(reportDir)
	for _, name := range []string{"powermetrics.txt", "pprof-closed.pb.gz"} {
		copyIfExists(filepath.Join(work, name), filepath.Join(reportDir, name))
	}
	if pth := os.Getenv("AFTERTRACE_HARNESS_JSON"); pth != "" {
		if err := rep.Write(pth); err != nil {
			t.Fatal(err)
		}
	}
	t.Logf("wrote reports in %s and %s (elapsed %s)", work, reportDir, time.Duration(rep.ElapsedMS)*time.Millisecond)
	// Report-only: do not t.Fatal on a budget miss. Invalid is logged here and
	// fails the ratchet, never skipped.
	for _, b := range rep.Budgets {
		if b.Invalid {
			t.Logf("%s INVALID: %s", b.ID, b.Notes)
			continue
		}
		if b.Pass {
			t.Logf("%s PASS", b.ID)
			continue
		}
		t.Logf("%s known miss (report-only): %s measured=%s", b.ID, b.Target, stringify(b.Measured))
	}
	if os.Getenv("AFTERTRACE_HARNESS_RATCHET") == "0" {
		return
	}
	rpath := defaultRatchetPath(p.Name)
	if rpath == "" {
		return
	}
	base, err := loadRatchet(rpath)
	if err != nil {
		if os.IsNotExist(err) {
			t.Logf("no ratchet file %s", rpath)
			return
		}
		t.Fatalf("ratchet: %v", err)
	}
	if errs := checkRatchet(rep, base); len(errs) > 0 {
		t.Errorf("ratchet: %v", errs)
	}
}

func copyIfExists(src, dst string) {
	in, err := os.Open(src)
	if err != nil {
		return
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return
	}
	defer out.Close()
	_, _ = io.Copy(out, in)
}
