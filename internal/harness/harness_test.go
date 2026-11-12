package harness

import (
	"math/rand/v2"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestParseSize(t *testing.T) {
	cases := []struct {
		in   string
		want int64
	}{
		{"2GiB", 2 << 30},
		{"32MiB", 32 << 20},
		{"1GB", 1_000_000_000},
		{"100", 100},
		{"4096B", 4096},
	}
	for _, c := range cases {
		got, err := ParseSize(c.in)
		if err != nil || got != c.want {
			t.Errorf("ParseSize(%q)=%d %v want %d", c.in, got, err, c.want)
		}
	}
	if _, err := ParseSize("nope"); err == nil {
		t.Fatal("expected error")
	}
}

func TestGenerateHistoryDeterministic(t *testing.T) {
	a := filepath.Join(t.TempDir(), "a")
	b := filepath.Join(t.TempDir(), "b")
	opts := GenOpts{Size: 1 << 20, Sessions: 12, Seed: 42}
	ra, err := GenerateHistory(a, opts)
	if err != nil {
		t.Fatal(err)
	}
	rb, err := GenerateHistory(b, opts)
	if err != nil {
		t.Fatal(err)
	}
	if ra.Bytes != rb.Bytes || ra.Sessions != 12 || ra.Files < 12 {
		t.Fatalf("result a=%+v b=%+v", ra, rb)
	}
	if ra.Bytes < opts.Size {
		t.Fatalf("bytes %d want >= %d", ra.Bytes, opts.Size)
	}
	fa, fb := treeFiles(t, a), treeFiles(t, b)
	if len(fa) != len(fb) {
		t.Fatalf("file count %d vs %d", len(fa), len(fb))
	}
	var sawDup, sawMal, sawPart, sawSub bool
	for rel, pa := range fa {
		pb, ok := fb[rel]
		if !ok {
			t.Fatalf("missing %s in b", rel)
		}
		ba, _ := os.ReadFile(pa)
		bb, _ := os.ReadFile(pb)
		if string(ba) != string(bb) {
			t.Fatalf("mismatch %s", rel)
		}
		s := string(ba)
		if strings.Count(s, `"uuid":"`) > 0 && strings.Contains(s, "prompt-replay-") {
			sawDup = true
		}
		if strings.Contains(s, "{not valid json") {
			sawMal = true
		}
		if strings.Contains(s, `{"type":"assistant","uuid":"partial-`) && !strings.HasSuffix(strings.TrimSpace(s), "}") {
			sawPart = true
		}
		if strings.Contains(rel, "subagents") {
			sawSub = true
		}
	}
	if !sawDup || !sawMal || !sawPart || !sawSub {
		t.Fatalf("features dup=%v mal=%v part=%v sub=%v", sawDup, sawMal, sawPart, sawSub)
	}
}

func treeFiles(t *testing.T, root string) map[string]string {
	t.Helper()
	out := map[string]string{}
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		out[rel] = path
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestProfiles(t *testing.T) {
	ci := profileNamed("ci")
	if ci.Size != 32<<20 || ci.Idle != 20*time.Second || ci.Sessions != 80 {
		t.Fatalf("ci: %+v", ci)
	}
	if !ci.SmallCorpus() || !ci.ShortIdle() {
		t.Fatal("ci should be marked small/short")
	}
	nightly := profileNamed("nightly")
	if nightly.Size != 512<<20 || nightly.Idle != 10*time.Minute || nightly.Sessions != 800 {
		t.Fatalf("nightly: %+v", nightly)
	}
	if !nightly.SmallCorpus() {
		t.Fatal("512 MiB is not a 2 GiB corpus")
	}
	if nightly.ShortIdle() {
		t.Fatal("nightly idle should be 10 minutes")
	}
	full := profileNamed("full")
	if full.Size != 2<<30 || full.Sessions != 3000 || full.Idle != 10*time.Minute {
		t.Fatalf("full: %+v", full)
	}
	if full.SmallCorpus() || full.ShortIdle() {
		t.Fatal("full should be representative")
	}
}

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

func TestMarkdownNotRepresentative(t *testing.T) {
	r := &Report{Profile: "ci", Corpus: "32 MiB"}
	r.add(Budget{ID: "B4", Name: "RSS", Target: "≤350 MB", Pass: true, Representative: false, Measured: "136 MB"})
	md := r.Markdown()
	if !strings.Contains(md, "not representative") {
		t.Fatalf("markdown:\n%s", md)
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
