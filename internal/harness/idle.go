//go:build unix

package harness

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

type idleTraffic struct {
	hits sync.Map // name -> *atomic.Int64
}

func (tr *idleTraffic) add(name string, n int64) {
	v, _ := tr.hits.LoadOrStore(name, &atomic.Int64{})
	v.(*atomic.Int64).Add(n)
}

func (tr *idleTraffic) snapshot() map[string]int64 {
	out := map[string]int64{}
	tr.hits.Range(func(k, v any) bool {
		out[k.(string)] = v.(*atomic.Int64).Load()
		return true
	})
	return out
}

func resolveCadence(proc *Proc, polls []Poll) []Poll {
	if len(polls) == 0 {
		return polls
	}
	sid := ""
	if proc != nil {
		// /api/sessions is a full list and can exceed the HTTP timeout on a
		// 2 GiB corpus. Glance and overview both embed a session_id.
		for _, path := range []string{"/api/glance", "/api/overview", "/api/sessions"} {
			_, body, _, err := proc.GET(path)
			if err != nil {
				continue
			}
			if i := strings.Index(string(body), `"session_id":"`); i >= 0 {
				rest := string(body[i+len(`"session_id":"`):])
				if j := strings.Index(rest, `"`); j > 0 {
					sid = rest[:j]
					break
				}
			}
		}
	}
	out := make([]Poll, 0, len(polls))
	for _, p := range polls {
		paths := make([]string, 0, len(p.Paths))
		for _, path := range p.Paths {
			if strings.Contains(path, "{id}") {
				if sid == "" {
					continue
				}
				path = strings.ReplaceAll(path, "{id}", sid)
			}
			paths = append(paths, path)
		}
		q := p
		q.Paths = paths
		out = append(out, q)
	}
	return out
}

func startScenario(proc *Proc, scenario string, stop <-chan struct{}) *idleTraffic {
	tr := &idleTraffic{}
	polls := resolveCadence(proc, Cadences[scenario])
	for _, p := range polls {
		p := p
		if p.Every <= 0 || len(p.Paths) == 0 {
			continue
		}
		go func() {
			hit := func() {
				for _, path := range p.Paths {
					_, _, _, _ = proc.GET(path)
				}
				tr.add(p.Name, 1)
			}
			hit()
			tk := time.NewTicker(p.Every)
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
	}
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

func (e errWarmTimeout) Error() string { return "warm: timeout after " + e.d.String() }

func measureCPUWindow(t *testing.T, proc *Proc, d time.Duration, drive func(stop <-chan struct{})) (cpu float64, wall time.Duration, err error) {
	t.Helper()
	cpu0, err := CPUSeconds(proc.PID())
	if err != nil {
		return -1, 0, err
	}
	stop := make(chan struct{})
	if drive != nil {
		go drive(stop)
	}
	t0 := time.Now()
	time.Sleep(d)
	close(stop)
	wall = time.Since(t0)
	cpu1, err := CPUSeconds(proc.PID())
	if err != nil {
		return -1, wall, err
	}
	return cpu1 - cpu0, wall, nil
}

func measureNoTraffic(t *testing.T, proc *Proc, p Profile) EndpointCPU {
	d := p.Isolation()
	cpu, wall, err := measureCPUWindow(t, proc, d, nil)
	if err != nil {
		t.Logf("isolation none: %v", err)
		cpu = -1
	}
	row := EndpointCPU{Name: "none", Path: "(no traffic)", CPUSeconds: cpu, WallSeconds: wall.Seconds(), Window: d.String()}
	t.Logf("isolation none cpu=%.3fs / %s", cpu, d)
	time.Sleep(time.Second)
	return row
}

func captureClosedPprof(t *testing.T, proc *Proc, work string, p Profile) *PprofSummary {
	t.Helper()
	sec := p.PprofSeconds()
	out := filepath.Join(work, "pprof-closed.pb.gz")
	stop := make(chan struct{})
	tr := startScenario(proc, ScenarioClosed, stop)
	sum := capturePprofCPU(t, proc, sec, out)
	close(stop)
	if sum != nil {
		sum.Hits = tr.snapshot()
		sum.Seconds = sec
		t.Logf("pprof closed %ds top=\n%s\ntags=\n%s", sec, sum.Top, sum.Tags)
	}
	return sum
}

func capturePprofCPU(t *testing.T, proc *Proc, seconds int, outPath string) *PprofSummary {
	t.Helper()
	if proc == nil || proc.UI == "" {
		return nil
	}
	url := fmt.Sprintf("http://%s/debug/pprof/profile?seconds=%d", proc.UI, seconds)
	client := &http.Client{Timeout: time.Duration(seconds+30) * time.Second}
	res, err := client.Get(url)
	if err != nil {
		t.Logf("pprof profile: %v", err)
		return &PprofSummary{Seconds: seconds, Top: err.Error()}
	}
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Logf("pprof read: %v", err)
		return &PprofSummary{Seconds: seconds, Top: err.Error()}
	}
	if res.StatusCode != 200 {
		t.Logf("pprof status %d: %s", res.StatusCode, trim(body, 200))
		return &PprofSummary{Seconds: seconds, Top: fmt.Sprintf("status %d", res.StatusCode)}
	}
	if err := os.WriteFile(outPath, body, 0o644); err != nil {
		t.Logf("pprof write: %v", err)
	}
	top := pprofText(outPath, "-top")
	tags := pprofText(outPath, "-tags")
	return &PprofSummary{Seconds: seconds, File: outPath, Top: top, Tags: tags}
}

func pprofText(profile, flag string) string {
	cmd := exec.Command("go", "tool", "pprof", flag, "-nodecount=20", profile)
	b, err := cmd.CombinedOutput()
	if err != nil {
		return strings.TrimSpace(string(b)) + " " + err.Error()
	}
	s := strings.TrimSpace(string(b))
	if len(s) > 4000 {
		s = s[:4000] + "…"
	}
	return s
}

// powermetricsStopWait is how long we wait after sudo kill -INT on the
// powermetrics child before sudo kill -9. SIGINT/SIGKILL of sudo's process
// group (the harness user) does not kill a root child: nightly 43478795531
// killed sudo and left powermetrics running.
const powermetricsStopWait = 5 * time.Second

func startPowermetrics(t *testing.T, out string, window time.Duration) func() {
	t.Helper()
	if os.Getenv("AFTERTRACE_POWERMETRICS") != "1" {
		return func() {}
	}
	if err := exec.Command("sudo", "-n", "true").Run(); err != nil {
		t.Log("TODO: powermetrics needs passwordless sudo or a self-hosted Mac runner.")
		return func() {}
	}
	f, err := os.Create(out)
	if err != nil {
		t.Logf("powermetrics out: %v", err)
		return func() {}
	}
	samples := int(window/time.Second) + 15
	if samples < 5 {
		samples = 5
	}
	cmd := exec.Command("sudo", "-n", "powermetrics",
		"--samplers", "cpu_power,tasks",
		"-i", "1000",
		"-n", strconv.Itoa(samples),
		"-f", "text",
		"--show-process-coalition")
	cmd.Stdout = f
	cmd.Stderr = f
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		f.Close()
		t.Logf("powermetrics: %v", err)
		return func() {}
	}
	sudoPID := cmd.Process.Pid
	child := waitNamedChild(sudoPID, "powermetrics", 3*time.Second)
	t.Logf("powermetrics sudo pid %d child pid %d samples %d during idle", sudoPID, child, samples)
	return func() {
		killed := stopRootChild(t, cmd.Process, child)
		if killed {
			t.Log("powermetrics did not exit after SIGINT; sudo kill -9 on child pid")
		}
		f.Close()
	}
}

// stopRootChild sends sudo kill -INT then sudo kill -9 to child, then waits
// for sudo. It never pgrep -x's a process name across the machine.
func stopRootChild(t *testing.T, sudo *os.Process, child int) (killed bool) {
	t.Helper()
	sudoPID := 0
	if sudo != nil {
		sudoPID = sudo.Pid
	}
	t.Logf("stopping root child pid %d (sudo %d)", child, sudoPID)
	if child > 0 {
		killed = stopRootPID(child, powermetricsStopWait)
	} else {
		t.Log("no root child pid; not sending a system-wide kill")
	}
	if sudo != nil && pidAlive(sudo.Pid) {
		_ = exec.Command("sudo", "-n", "kill", "-9", strconv.Itoa(sudo.Pid)).Run()
	}
	waitProc(sudo, 2*time.Second)
	return killed
}

// stopProcessGroup sends SIGINT, waits graceful, then SIGKILL's the
// process group. Returns true if it had to SIGKILL or abandon Wait.
// This cannot stop a root child of sudo; use stopRootPID for that.
func stopProcessGroup(p *os.Process, graceful time.Duration) (killed bool) {
	if p == nil {
		return false
	}
	pgid := p.Pid
	_ = syscall.Kill(-pgid, syscall.SIGINT)
	_ = p.Signal(os.Interrupt)
	done := make(chan struct{})
	go func() {
		_, _ = p.Wait()
		close(done)
	}()
	select {
	case <-done:
		return false
	case <-time.After(graceful):
		_ = syscall.Kill(-pgid, syscall.SIGKILL)
		_ = p.Kill()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
		}
		return true
	}
}

func pidAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || err == syscall.EPERM
}

func pgrepChildren(parent int) []int {
	if parent <= 0 {
		return nil
	}
	out, err := exec.Command("pgrep", "-P", strconv.Itoa(parent)).Output()
	if err != nil {
		return nil
	}
	return parsePIDs(string(out))
}

func parsePIDs(s string) []int {
	var pids []int
	for _, line := range strings.Split(strings.TrimSpace(s), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		pid, err := strconv.Atoi(line)
		if err == nil && pid > 1 {
			pids = append(pids, pid)
		}
	}
	return pids
}

func procName(pid int) string {
	out, err := exec.Command("ps", "-o", "comm=", "-p", strconv.Itoa(pid)).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func waitNamedChild(parent int, name string, d time.Duration) int {
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		children := pgrepChildren(parent)
		for _, pid := range children {
			n := strings.ToLower(procName(pid))
			if strings.Contains(n, strings.ToLower(name)) {
				return pid
			}
		}
		if len(children) == 1 {
			return children[0]
		}
		time.Sleep(50 * time.Millisecond)
	}
	return 0
}

// stopRootPID sends SIGINT then SIGKILL as root via sudo kill, targeting
// pid itself (the root child), not sudo. Returns true if SIGKILL ran.
func stopRootPID(pid int, graceful time.Duration) (killed bool) {
	if pid <= 0 {
		return false
	}
	_ = exec.Command("sudo", "-n", "kill", "-INT", strconv.Itoa(pid)).Run()
	deadline := time.Now().Add(graceful)
	for time.Now().Before(deadline) {
		if !pidAlive(pid) {
			return false
		}
		time.Sleep(50 * time.Millisecond)
	}
	_ = exec.Command("sudo", "-n", "kill", "-9", strconv.Itoa(pid)).Run()
	for i := 0; i < 40; i++ {
		if !pidAlive(pid) {
			return true
		}
		time.Sleep(50 * time.Millisecond)
	}
	return true
}

func waitProc(p *os.Process, d time.Duration) {
	if p == nil {
		return
	}
	done := make(chan struct{})
	go func() {
		_, _ = p.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(d):
	}
}
