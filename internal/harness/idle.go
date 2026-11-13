//go:build unix

package harness

import (
	"os"
	"os/exec"
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

func startScenario(proc *Proc, scenario string, stop <-chan struct{}) *idleTraffic {
	tr := &idleTraffic{}
	for _, p := range Cadences[scenario] {
		p := p
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
