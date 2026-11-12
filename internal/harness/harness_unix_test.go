//go:build unix

package harness

import (
	"math/rand/v2"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDesktopIdleCadence(t *testing.T) {
	if desktopHealthEvery != time.Second {
		t.Fatalf("health %s", desktopHealthEvery)
	}
	if desktopGlanceEvery != 45*time.Second {
		t.Fatalf("glance %s want 45s (tray IDLE_MS)", desktopGlanceEvery)
	}
	if desktopFindingsEvery != 30*time.Second {
		t.Fatalf("findings %s want 30s", desktopFindingsEvery)
	}
}

func TestCrashKillAfter(t *testing.T) {
	rng := rand.New(rand.NewPCG(1, 2))
	d := crashKillAfter(rng, 2*time.Second, false)
	if d < 50*time.Millisecond || d > 1600*time.Millisecond {
		t.Fatalf("short import kill %s", d)
	}
	d = crashKillAfter(rng, 90*time.Second, true)
	if d < 50*time.Millisecond || d > 1600*time.Millisecond {
		t.Fatalf("small-corpus kill %s", d)
	}
	d = crashKillAfter(rng, 20*time.Minute, false)
	if d < 2*time.Second || d > 5*time.Minute {
		t.Fatalf("long import kill %s", d)
	}
}

func TestScaleBudgets(t *testing.T) {
	if os.Getenv("AFTERTRACE_HARNESS") != "1" {
		t.Skip("set AFTERTRACE_HARNESS=1 to run the report-only scale harness")
	}
	p := ProfileFromEnv()
	work := t.TempDir()
	if out := os.Getenv("AFTERTRACE_HARNESS_OUT"); out != "" {
		work = out
		if err := os.MkdirAll(work, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	bin, err := BuildBin(work)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("profile %s corpus %s bin %s", p.Name, p.CorpusNote(), bin)
	rep, err := Run(t, p, bin, work)
	if err != nil {
		t.Fatalf("harness infrastructure: %v", err)
	}
	md := rep.Markdown()
	t.Log("\n" + md)
	jsonPath := filepath.Join(work, "budgets.json")
	if err := rep.Write(jsonPath); err != nil {
		t.Fatal(err)
	}
	if pth := os.Getenv("AFTERTRACE_HARNESS_JSON"); pth != "" {
		if err := rep.Write(pth); err != nil {
			t.Fatal(err)
		}
	}
	mdPath := filepath.Join(work, "budgets.md")
	if err := os.WriteFile(mdPath, []byte(md), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Logf("wrote %s and %s (elapsed %s)", jsonPath, mdPath, time.Duration(rep.ElapsedMS)*time.Millisecond)
	// Report-only: do not t.Fatal on a budget miss.
	for _, b := range rep.Budgets {
		if b.Pass {
			t.Logf("%s PASS", b.ID)
			continue
		}
		t.Logf("%s known miss (report-only): %s measured=%s", b.ID, b.Target, stringify(b.Measured))
	}
}
