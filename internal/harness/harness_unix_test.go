//go:build unix

package harness

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCrashKillPct(t *testing.T) {
	if g := crashKillPct(0, 10); g != 5 {
		t.Fatalf("first %d", g)
	}
	if g := crashKillPct(9, 10); g != 90 {
		t.Fatalf("last %d", g)
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
