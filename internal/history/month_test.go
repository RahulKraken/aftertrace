package history

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/RahulKraken/aftertrace/internal/rules"
)

// monthTree writes a synthetic Claude Code projects tree: ~30 days, three
// projects, two sessions a day, eight turns each. Realistic first-open size
// without committing a huge fixture.
func monthTree(t *testing.T) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), "projects")
	projects := []string{"aftertrace", "notes-app", "dotfiles"}
	start := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
	n := 0
	for d := 0; d < 30; d++ {
		for s := 0; s < 2; s++ {
			proj := projects[(d+s)%len(projects)]
			sid := fmt.Sprintf("m%02d%02d-%s-4aaa-8aaa-aaaaaaaaaaaa", d, s, strings.Repeat("a", 4))
			// session ids must look like uuids for the importer; keep 36 chars.
			sid = fmt.Sprintf("%08x-aaaa-4aaa-8aaa-%012d", d*10+s, d*10+s)
			dir := filepath.Join(root, "-home-user-"+proj)
			if err := os.MkdirAll(dir, 0o755); err != nil {
				t.Fatal(err)
			}
			day := start.Add(time.Duration(d) * 24 * time.Hour).Add(time.Duration(s) * 3 * time.Hour)
			if err := os.WriteFile(filepath.Join(dir, sid+".jsonl"), monthSession(sid, proj, day), 0o644); err != nil {
				t.Fatal(err)
			}
			n++
		}
	}
	if n != 60 {
		t.Fatalf("wrote %d sessions", n)
	}
	return root
}

func monthSession(sid, proj string, t0 time.Time) []byte {
	var b strings.Builder
	cwd := "/home/user/" + proj
	line := func(s string) { b.WriteString(s); b.WriteByte('\n') }
	line(fmt.Sprintf(`{"type":"ai-title","uuid":"%s-title","timestamp":"%s","sessionId":"%s","cwd":"%s","version":"2.1.305","title":"Work on %s"}`, sid[:8], iso(t0), sid, cwd, proj))
	cache := 4000
	for i := 0; i < 8; i++ {
		at := t0.Add(time.Duration(i) * 6 * time.Minute)
		pid := fmt.Sprintf("%s-p%d", sid[:8], i)
		model := "claude-sonnet-4"
		if i >= 6 {
			model = "claude-opus-4-6"
		}
		read := cache
		create := 200
		if i == 0 || i == 6 {
			read, create = 0, cache
		}
		if i == 4 {
			line(fmt.Sprintf(`{"type":"system","uuid":"%s-c%d","timestamp":"%s","sessionId":"%s","cwd":"%s","version":"2.1.305","subtype":"compact_boundary"}`, sid[:8], i, iso(at.Add(-time.Second)), sid, cwd))
			read, create = 0, 1500
			cache = 1500
		}
		line(fmt.Sprintf(`{"type":"user","uuid":"%s-u%d","timestamp":"%s","sessionId":"%s","cwd":"%s","version":"2.1.305","promptId":"%s","message":{"role":"user","content":"turn %d"}}`, sid[:8], i, iso(at), sid, cwd, pid, i))
		tool := ""
		if i%3 == 1 {
			tool = fmt.Sprintf(`{"type":"tool_use","id":"toolu_%s_%d","name":"Bash","input":{"command":"ls"}}`, sid[:8], i)
		}
		content := fmt.Sprintf(`{"type":"text","text":"ok %d"}`, i)
		if tool != "" {
			content = content + "," + tool
		}
		out := 40 + i
		line(fmt.Sprintf(`{"type":"assistant","uuid":"%s-a%d","timestamp":"%s","sessionId":"%s","cwd":"%s","version":"2.1.305","promptId":"%s","requestId":"req_%s_%d","message":{"id":"msg_%s_%d","role":"assistant","model":"%s","content":[%s],"usage":{"input_tokens":120,"output_tokens":%d,"cache_read_input_tokens":%d,"cache_creation_input_tokens":%d}}}`,
			sid[:8], i, iso(at.Add(2*time.Second)), sid, cwd, pid, sid[:8], i, sid[:8], i, model, content, out, read, create))
		if tool != "" {
			err := ""
			if i == 1 {
				err = `,"is_error":true`
			}
			line(fmt.Sprintf(`{"type":"user","uuid":"%s-r%d","timestamp":"%s","sessionId":"%s","cwd":"%s","version":"2.1.305","promptId":"%s","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_%s_%d","content":"ok"%s}]}}`,
				sid[:8], i, iso(at.Add(3*time.Second)), sid, cwd, pid, sid[:8], i, err))
		}
		cache += 200 + out
	}
	return []byte(b.String())
}

func iso(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func TestMonthImportAndRulesTiming(t *testing.T) {
	dir := monthTree(t)
	st := openStore(t)

	t0 := time.Now()
	res, err := Import(st, dir)
	if err != nil {
		t.Fatal(err)
	}
	importMS := time.Since(t0).Milliseconds()
	if res.Sessions != 60 {
		t.Fatalf("sessions=%d want 60: %+v", res.Sessions, res)
	}

	t1 := time.Now()
	fs := rules.RunAll(st.DB)
	rulesMS := time.Since(t1).Milliseconds()
	t.Logf("month fixture: import=%dms rules=%dms sessions=%d turns=%d requests=%d findings=%d",
		importMS, rulesMS, res.Sessions, res.Turns, res.Requests, len(fs))
	// Baseline 2026-10-29, before history-rule work, same fixture: import=2764ms
	// rules=78ms. First open with a month of history should stay interactive;
	// the UI waits on /api/status, which reuses the 10s findings cache.
	if importMS+rulesMS > 8000 {
		t.Errorf("first-open path too slow: import %dms + rules %dms", importMS, rulesMS)
	}
}
