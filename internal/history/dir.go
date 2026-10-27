package history

import (
	"os"
	"path/filepath"
	"strings"
)

// DefaultDir is ~/.claude/projects, where Claude Code writes session JSONL.
func DefaultDir() string {
	h, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(h, ".claude", "projects")
}

// File is one transcript: a top-level session JSONL, or a subagent file
// nested under <session-id>/subagents/.
type File struct {
	Path      string
	SessionID string
	Subagent  bool
	Size      int64
	MtimeNS   int64
}

// ListTranscripts returns session JSONL files under a Claude Code projects
// tree. Only top-level *.jsonl in each project slug, plus subagent transcripts.
// A recursive walk would pick up memory notes and other files that are not
// sessions.
func ListTranscripts(root string) ([]File, error) {
	ents, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	var out []File
	for _, p := range ents {
		if !p.IsDir() {
			continue
		}
		proj := filepath.Join(root, p.Name())
		files, err := os.ReadDir(proj)
		if err != nil {
			continue
		}
		for _, e := range files {
			name := e.Name()
			if e.IsDir() {
				out = append(out, listSubagents(proj, name)...)
				continue
			}
			if !strings.HasSuffix(name, ".jsonl") {
				continue
			}
			f, err := statFile(filepath.Join(proj, name), strings.TrimSuffix(name, ".jsonl"), false)
			if err != nil {
				continue
			}
			out = append(out, f)
		}
	}
	return out, nil
}

func listSubagents(proj, sessionID string) []File {
	dir := filepath.Join(proj, sessionID, "subagents")
	ents, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []File
	for _, e := range ents {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		f, err := statFile(filepath.Join(dir, e.Name()), sessionID, true)
		if err != nil {
			continue
		}
		out = append(out, f)
	}
	return out
}

func statFile(path, sessionID string, subagent bool) (File, error) {
	st, err := os.Stat(path)
	if err != nil {
		return File{}, err
	}
	return File{
		Path:      path,
		SessionID: sessionID,
		Subagent:  subagent,
		Size:      st.Size(),
		MtimeNS:   st.ModTime().UnixNano(),
	}, nil
}
