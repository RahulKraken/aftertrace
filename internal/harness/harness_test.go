package harness

import (
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

func TestMarkdownNotRepresentative(t *testing.T) {
	r := &Report{Profile: "ci", Corpus: "32 MiB"}
	r.add(Budget{ID: "B4", Name: "RSS", Target: "≤350 MB", Pass: true, Representative: false, Measured: "136 MB"})
	md := r.Markdown()
	if !strings.Contains(md, "not representative") {
		t.Fatalf("markdown:\n%s", md)
	}
}
