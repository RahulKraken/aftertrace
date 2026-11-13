//go:build unix

package harness

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
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
	var sess []struct {
		ID string `json:"session_id"`
	}
	if proc != nil && proc.JSON("/api/sessions", &sess) == nil && len(sess) > 0 {
		sid = sess[0].ID
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

func captureClosedPprof(t *testing.T, proc *Proc, work string, d time.Duration) *PprofSummary {
	t.Helper()
	sec := int(d.Seconds())
	if sec < 5 {
		sec = 5
	}
	if sec > 30 {
		sec = 30
	}
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
	client := &http.Client{Timeout: time.Duration(seconds+15) * time.Second}
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

func startPowermetrics(t *testing.T, out string) func() {
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
	cmd := exec.Command("sudo", "-n", "powermetrics", "--samplers", "cpu_power,tasks", "-i", "1000", "-f", "text", "--show-process-coalition")
	cmd.Stdout = f
	cmd.Stderr = f
	if err := cmd.Start(); err != nil {
		f.Close()
		t.Logf("powermetrics: %v", err)
		return func() {}
	}
	t.Logf("powermetrics pid %d during idle", cmd.Process.Pid)
	return func() {
		_ = cmd.Process.Signal(os.Interrupt)
		_, _ = cmd.Process.Wait()
		f.Close()
	}
}
