package harness

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type Report struct {
	Profile     string   `json:"profile"`
	Corpus      string   `json:"corpus"`
	CorpusBytes int64    `json:"corpus_bytes"`
	GitSHA      string   `json:"git_sha,omitempty"`
	GOOS        string   `json:"goos"`
	GOARCH      string   `json:"goarch"`
	Started     string   `json:"started"`
	ElapsedMS   int64    `json:"elapsed_ms"`
	Budgets     []Budget `json:"budgets"`
	Notes       []string `json:"notes,omitempty"`
}

type Budget struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Target         string `json:"target"`
	Measured       any    `json:"measured"`
	Pass           bool   `json:"pass"`
	ReportOnly     bool   `json:"report_only"`
	Corpus         string `json:"corpus"`
	Notes          string `json:"notes,omitempty"`
	Representative bool   `json:"representative"`
}

func newReport(p Profile) *Report {
	return &Report{
		Profile:     p.Name,
		Corpus:      p.CorpusNote(),
		CorpusBytes: p.Size,
		GitSHA:      gitSHA(),
		GOOS:        runtime.GOOS,
		GOARCH:      runtime.GOARCH,
		Started:     time.Now().UTC().Format(time.RFC3339),
	}
}

func (r *Report) add(b Budget) {
	b.ReportOnly = true
	if b.Corpus == "" {
		b.Corpus = r.Corpus
	}
	r.Budgets = append(r.Budgets, b)
}

func (r *Report) Write(path string) error {
	b, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

func (r *Report) Markdown() string {
	var b strings.Builder
	fmt.Fprintf(&b, "## Scale harness (report-only)\n\n")
	fmt.Fprintf(&b, "Profile `%s`. Corpus **%s**. GOOS=%s GOARCH=%s sha=%s elapsed=%dms.\n\n",
		r.Profile, r.Corpus, r.GOOS, r.GOARCH, r.GitSHA, r.ElapsedMS)
	fmt.Fprintf(&b, "Budget misses do not fail CI. Later PRs turn each row into a hard gate.\n\n")
	fmt.Fprintf(&b, "| ID | Budget | Target | Measured | vs target |\n|---|---|---|---|---|\n")
	for _, x := range r.Budgets {
		vs := "miss"
		if x.Pass {
			vs = "pass"
		}
		if !x.Representative {
			if x.Pass {
				vs = "pass, not representative"
			} else {
				vs = "miss, not representative"
			}
		}
		fmt.Fprintf(&b, "| %s | %s | %s | %s | %s |\n", x.ID, x.Name, x.Target, stringify(x.Measured), vs)
		if x.Notes != "" {
			fmt.Fprintf(&b, "|  |  |  |  | _%s_ |\n", strings.ReplaceAll(x.Notes, "|", "/"))
		}
	}
	if len(r.Notes) > 0 {
		fmt.Fprintf(&b, "\n")
		for _, n := range r.Notes {
			fmt.Fprintf(&b, "- %s\n", n)
		}
	}
	return b.String()
}

func stringify(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case nil:
		return ""
	default:
		b, err := json.Marshal(t)
		if err != nil {
			return fmt.Sprint(v)
		}
		return string(b)
	}
}

func findModRoot() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for p := wd; ; p = filepath.Dir(p) {
		if _, err := os.Stat(filepath.Join(p, "go.mod")); err == nil {
			return p, nil
		}
		if filepath.Dir(p) == p {
			return "", fmt.Errorf("go.mod not found from %s", wd)
		}
	}
}

func gitSHA() string {
	root, err := findModRoot()
	if err != nil {
		root = "."
	}
	b, err := os.ReadFile(filepath.Join(root, ".git/HEAD"))
	if err != nil {
		return ""
	}
	s := strings.TrimSpace(string(b))
	if strings.HasPrefix(s, "ref:") {
		ref := strings.TrimSpace(strings.TrimPrefix(s, "ref:"))
		c, err := os.ReadFile(filepath.Join(root, ".git", ref))
		if err != nil {
			return s
		}
		return strings.TrimSpace(string(c))
	}
	return s
}
