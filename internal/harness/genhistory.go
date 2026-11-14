package harness

import (
	"fmt"
	"math/rand/v2"
	"os"
	"path/filepath"
	"time"
)

// GenOpts is the deterministic Claude Code projects tree the scale harness uses.
type GenOpts struct {
	Size     int64
	Sessions int
	Seed     int64
}

type GenResult struct {
	Dir      string
	Bytes    int64
	Sessions int
	Files    int
	Projects int
}

var projectSlugs = []struct {
	slug, cwd, title string
}{
	{"-Users-harness-aftertrace", "/Users/harness/aftertrace", "Wire the import path"},
	{"-Users-harness-notes", "/Users/harness/notes", "Tidy weekly notes"},
	{"-Users-harness-app", "/Users/harness/app", "Fix the flaky test"},
	{"-Users-harness-inbox", "/Users/harness/inbox", "Triage the inbox"},
	{"-Users-harness-cli", "/Users/harness/cli", "Add a hidden flag"},
	{"-Users-harness-web", "/Users/harness/web", "Polish the settings pane"},
	{"-Users-harness-rules", "/Users/harness/rules", "Tighten a SQL rule"},
	{"-Users-harness-docs", "/Users/harness/docs", "Rewrite the store page"},
}

var models = []string{
	"claude-opus-4-5",
	"claude-sonnet-4-5",
	"claude-haiku-4-5",
	"claude-opus-4-6",
}

var tools = []string{"Bash", "Read", "Edit", "Grep", "Glob", "mcp__github__search"}

// GenerateHistory writes a Claude Code ~/.claude/projects tree. Same seed and
// size yield the same files. Includes large tool results, subagents, resumed
// sessions with duplicate UUIDs, a partial trailing line, and malformed lines.
func GenerateHistory(dir string, opts GenOpts) (GenResult, error) {
	if opts.Sessions < 1 {
		return GenResult{}, fmt.Errorf("sessions must be >= 1")
	}
	if opts.Size < 1 {
		return GenResult{}, fmt.Errorf("size must be >= 1")
	}
	if err := os.RemoveAll(dir); err != nil {
		return GenResult{}, err
	}
	rng := rand.New(rand.NewPCG(uint64(opts.Seed), uint64(opts.Seed)^0x9e3779b97f4a7c15))
	pad := make([]byte, 64*1024)
	for i := range pad {
		pad[i] = 'x'
	}

	type slot struct {
		proj   int
		sid    string
		sub    bool
		resume bool
		mal    bool
		part   bool
		pad    int64
	}
	slots := make([]slot, opts.Sessions)
	seen := map[string]struct{}{}
	for i := range slots {
		sid := uuidAt(rng)
		for {
			if _, ok := seen[sid]; !ok {
				break
			}
			sid = uuidAt(rng)
		}
		seen[sid] = struct{}{}
		slots[i] = slot{
			proj:   i % len(projectSlugs),
			sid:    sid,
			sub:    i%10 == 3,
			resume: i%7 == 1,
			mal:    i%11 == 2,
			part:   i%13 == 5,
		}
	}

	// Most of the bytes live in a few large tool-result sessions so a 2GiB
	// tree does not need 3000 huge files. Remainder is spread evenly.
	large := opts.Sessions / 8
	if large < 1 {
		large = 1
	}
	if large > 64 {
		large = 64
	}
	base := opts.Size / int64(opts.Sessions)
	if base < 2048 {
		base = 2048
	}
	var assigned int64
	for i := range slots {
		n := base
		if i < large {
			n = opts.Size / 2 / int64(large)
		}
		slots[i].pad = n
		assigned += n
	}
	if assigned < opts.Size {
		slots[0].pad += opts.Size - assigned
	}

	var res GenResult
	res.Dir = dir
	res.Sessions = opts.Sessions
	usedProj := map[int]struct{}{}
	for i, s := range slots {
		usedProj[s.proj] = struct{}{}
		p := projectSlugs[s.proj]
		projDir := filepath.Join(dir, p.slug)
		if err := os.MkdirAll(projDir, 0o755); err != nil {
			return res, err
		}
		path := filepath.Join(projDir, s.sid+".jsonl")
		n, err := writeSession(path, sessionSpec{
			ID:        s.sid,
			CWD:       p.cwd,
			Title:     p.title,
			Index:     i,
			Pad:       s.pad,
			Resume:    s.resume,
			Malformed: s.mal,
			Partial:   s.part,
			Subagent:  false,
			rng:       rng,
			pad:       pad,
		})
		if err != nil {
			return res, err
		}
		res.Bytes += n
		res.Files++
		if s.sub {
			subDir := filepath.Join(projDir, s.sid, "subagents")
			if err := os.MkdirAll(subDir, 0o755); err != nil {
				return res, err
			}
			sn, err := writeSession(filepath.Join(subDir, "agent-explore.jsonl"), sessionSpec{
				ID:       s.sid,
				CWD:      p.cwd,
				Title:    "Explore " + p.title,
				Index:    i,
				Pad:      4096,
				Subagent: true,
				rng:      rng,
				pad:      pad,
			})
			if err != nil {
				return res, err
			}
			res.Bytes += sn
			res.Files++
		}
	}
	res.Projects = len(usedProj)
	if res.Bytes < opts.Size {
		// Last-chance pad on the first file so --size is a floor.
		s := slots[0]
		p := projectSlugs[s.proj]
		path := filepath.Join(dir, p.slug, s.sid+".jsonl")
		f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o644)
		if err != nil {
			return res, err
		}
		need := opts.Size - res.Bytes
		line := 0
		for need > 0 {
			part := need
			if part > 512*1024 {
				part = 512 * 1024
			}
			n, err := writePadResult(f, s.sid, part, pad, 1000+line)
			if err != nil {
				f.Close()
				return res, err
			}
			res.Bytes += n
			need -= part
			line++
		}
		f.Close()
	}
	return res, nil
}

type sessionSpec struct {
	ID, CWD, Title string
	Index          int
	Pad            int64
	Resume         bool
	Malformed      bool
	Partial        bool
	Subagent       bool
	rng            *rand.Rand
	pad            []byte
}

func writeSession(path string, s sessionSpec) (int64, error) {
	f, err := os.Create(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	var n int64
	w := func(line string) error {
		c, err := f.WriteString(line)
		n += int64(c)
		return err
	}
	t0 := time.Date(2026, 1, 1, 9, 0, 0, 0, time.UTC).Add(time.Duration(s.Index) * time.Hour)
	sid := s.ID
	model := models[s.Index%len(models)]
	titleUUID := uuidAt(s.rng)
	userUUID := uuidAt(s.rng)
	if err := w(fmt.Sprintf(`{"type":"ai-title","uuid":%q,"timestamp":%q,"sessionId":%q,"cwd":%q,"version":"2.1.305","title":%q}`+"\n",
		titleUUID, t0.Format(time.RFC3339Nano), sid, s.CWD, s.Title)); err != nil {
		return n, err
	}
	promptID := fmt.Sprintf("prompt-%d-1", s.Index)
	if err := w(fmt.Sprintf(`{"type":"user","uuid":%q,"timestamp":%q,"sessionId":%q,"cwd":%q,"version":"2.1.305","promptId":%q,"message":{"role":"user","content":%q}}`+"\n",
		userUUID, t0.Add(time.Second).Format(time.RFC3339Nano), sid, s.CWD, promptID, s.Title+" — please do it")); err != nil {
		return n, err
	}

	// Stored DuckDB rows come from assistant usage turns. Tool-result
	// padding is stripped at ingest, so a 2 GiB tree of "xxxxx" still
	// yields a tiny DB and cannot speak to a 735 MB field file. Keep a
	// few large tool_result lines (B5) and spend the rest of the session
	// on turns the importer actually writes.
	turns := 48 + s.Index%32
	if s.Subagent {
		turns = 3
	}
	remaining := s.Pad
	if remaining < 512 {
		remaining = 512
	}
	line := 0
	for turn := 0; turn < turns; turn++ {
		ts := t0.Add(time.Duration(2+turn*8) * time.Second)
		asst := uuidAt(s.rng)
		req := fmt.Sprintf("req_%d_%d", s.Index, turn)
		tool := tools[(s.Index+turn)%len(tools)]
		toolID := fmt.Sprintf("toolu_%d_%d", s.Index, turn)
		inTok := 800 + s.Index%400
		outTok := 40 + turn*10
		cache := 2000 + turn*100
		if err := w(fmt.Sprintf(`{"type":"assistant","uuid":%q,"timestamp":%q,"sessionId":%q,"cwd":%q,"version":"2.1.305","promptId":%q,"requestId":%q,"message":{"id":"msg_%d_%d","role":"assistant","model":%q,"content":[{"type":"text","text":"working on it"},{"type":"tool_use","id":%q,"name":%q,"input":{"command":"ls"}}],"usage":{"input_tokens":%d,"output_tokens":%d,"cache_read_input_tokens":%d,"cache_creation_input_tokens":%d}}}`+"\n",
			asst, ts.Format(time.RFC3339Nano), sid, s.CWD, promptID, req, s.Index, turn, model, toolID, tool, inTok, outTok, cache, 100)); err != nil {
			return n, err
		}
		chunk := remaining / int64(turns-turn)
		if chunk < 64 {
			chunk = 64
		}
		if s.Subagent {
			chunk = 128
		}
		for chunk > 0 {
			part := chunk
			if part > 512*1024 {
				part = 512 * 1024
			}
			wrote, err := writePadResult(f, sid, part, s.pad, line)
			if err != nil {
				return n, err
			}
			n += wrote
			chunk -= part
			remaining -= part
			line++
		}
		if remaining < 0 {
			remaining = 0
		}
	}

	if s.Resume {
		// Same uuid as the first user line, different promptId — session resume.
		if err := w(fmt.Sprintf(`{"type":"user","uuid":%q,"timestamp":%q,"sessionId":%q,"cwd":%q,"version":"2.1.305","promptId":"prompt-replay-%d","message":{"role":"user","content":%q}}`+"\n",
			userUUID, t0.Add(time.Hour).Format(time.RFC3339Nano), sid, s.CWD, s.Index, s.Title+" — please do it")); err != nil {
			return n, err
		}
	}
	if s.Malformed {
		if err := w("{not valid json, on purpose}\n"); err != nil {
			return n, err
		}
		if err := w("[]\n"); err != nil {
			return n, err
		}
	}
	if s.Partial {
		if _, err := f.WriteString(`{"type":"assistant","uuid":"partial-`); err != nil {
			return n, err
		}
		n += int64(len(`{"type":"assistant","uuid":"partial-`))
	}
	return n, nil
}

func writePadResult(f *os.File, sessionID string, want int64, pad []byte, turn int) (int64, error) {
	header := fmt.Sprintf(`{"type":"user","uuid":"toolres-%s-%d","timestamp":"2026-01-01T09:00:08.000Z","sessionId":%q,"cwd":"/Users/harness/app","version":"2.1.305","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_pad_%d","content":"`,
		sessionID[:8], turn, sessionID, turn)
	footer := "\"}]}}\n"
	overhead := int64(len(header) + len(footer))
	body := want - overhead
	if body < 1 {
		body = 1
	}
	var n int64
	c, err := f.WriteString(header)
	n += int64(c)
	if err != nil {
		return n, err
	}
	for body > 0 {
		chunk := int64(len(pad))
		if chunk > body {
			chunk = body
		}
		c, err = f.Write(pad[:chunk])
		n += int64(c)
		body -= int64(c)
		if err != nil {
			return n, err
		}
	}
	c, err = f.WriteString(footer)
	n += int64(c)
	return n, err
}

func uuidAt(rng *rand.Rand) string {
	var b [16]byte
	for i := 0; i < 16; i += 8 {
		v := rng.Uint64()
		for j := 0; j < 8 && i+j < 16; j++ {
			b[i+j] = byte(v >> (8 * j))
		}
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
