package history

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"os"
	"strings"
	"time"
	"unicode/utf8"
)

// Record is the usage metadata we keep from one JSONL line. Prompt text,
// responses and tool input/output are counted then discarded.
type Record struct {
	Type        string
	UUID        string
	ParentUUID  string
	Timestamp   time.Time
	SessionID   string
	CWD         string
	Version     string
	GitBranch   string
	PromptID    string
	RequestID   string
	IsMeta      bool
	IsSidechain bool
	Subtype     string
	Title       string
	Model       string
	MessageID   string
	StopReason  string
	Usage       Usage
	PromptChars int
	HasText     bool
	HasToolRes  bool
	ToolUses    []ToolUse
	ToolResults []ToolResult
}

type Usage struct {
	Input           float64
	Output          float64
	CacheRead       float64
	CacheCreation   float64
	CacheCreation5m float64
	CacheCreation1h float64
}

type ToolUse struct {
	ID   string
	Name string
}

type ToolResult struct {
	ID      string
	IsError bool
}

// ParseFile reads a JSONL transcript. Unknown types and malformed lines are
// skipped. Duplicate uuids (session resume/rewind) collapse to one record:
// first promptId, last value for everything else, first-seen order.
func ParseFile(path string) ([]Record, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return Parse(f)
}

func Parse(r io.Reader) ([]Record, error) {
	br := bufio.NewReaderSize(r, 256*1024)
	order := make([]string, 0, 64)
	byUUID := map[string]Record{}
	n := 0
	for {
		line, err := br.ReadBytes('\n')
		if len(line) > 0 {
			line = bytes.TrimSpace(line)
			if len(line) > 0 {
				rec, ok := parseLine(line)
				if ok {
					if rec.UUID == "" {
						rec.UUID = "_anon_" + itoa(n)
					}
					n++
					if prev, exists := byUUID[rec.UUID]; exists {
						byUUID[rec.UUID] = mergeRecord(prev, rec)
					} else {
						byUUID[rec.UUID] = rec
						order = append(order, rec.UUID)
					}
				}
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
	}
	out := make([]Record, 0, len(order))
	for _, id := range order {
		out = append(out, byUUID[id])
	}
	return out, nil
}

func parseLine(line []byte) (Record, bool) {
	var m map[string]json.RawMessage
	if json.Unmarshal(line, &m) != nil || m == nil {
		return Record{}, false
	}
	rec := Record{
		Type:        str(m, "type"),
		UUID:        str(m, "uuid"),
		ParentUUID:  str(m, "parentUuid", "parent_uuid"),
		SessionID:   str(m, "sessionId", "session_id"),
		CWD:         str(m, "cwd"),
		Version:     str(m, "version"),
		GitBranch:   str(m, "gitBranch", "git_branch"),
		PromptID:    str(m, "promptId", "prompt_id"),
		RequestID:   str(m, "requestId", "request_id"),
		Subtype:     str(m, "subtype"),
		Title:       str(m, "title"),
		IsMeta:      boolVal(m, "isMeta", "is_meta"),
		IsSidechain: boolVal(m, "isSidechain", "is_sidechain"),
	}
	if rec.Type == "" {
		return Record{}, false
	}
	if ts := str(m, "timestamp"); ts != "" {
		rec.Timestamp = parseTime(ts)
	}
	if raw, ok := m["message"]; ok {
		parseMessage(raw, &rec)
	}
	if rec.Title == "" {
		rec.Title = str(m, "content")
	}
	if raw, ok := m["content"]; ok && rec.Type == "user" {
		parseContent(raw, &rec)
	}
	return rec, true
}

func parseMessage(raw json.RawMessage, rec *Record) {
	var m map[string]json.RawMessage
	if json.Unmarshal(raw, &m) != nil || m == nil {
		return
	}
	rec.Model = str(m, "model")
	rec.MessageID = str(m, "id")
	rec.StopReason = str(m, "stop_reason")
	if u, ok := m["usage"]; ok {
		rec.Usage = parseUsage(u)
	}
	if c, ok := m["content"]; ok {
		parseContent(c, rec)
	}
}

func parseUsage(raw json.RawMessage) Usage {
	var m map[string]json.RawMessage
	if json.Unmarshal(raw, &m) != nil || m == nil {
		return Usage{}
	}
	u := Usage{
		Input:         num(m, "input_tokens"),
		Output:        num(m, "output_tokens"),
		CacheRead:     num(m, "cache_read_input_tokens"),
		CacheCreation: num(m, "cache_creation_input_tokens"),
	}
	if c, ok := m["cache_creation"]; ok {
		var cm map[string]json.RawMessage
		if json.Unmarshal(c, &cm) == nil && cm != nil {
			u.CacheCreation5m = num(cm, "ephemeral_5m_input_tokens")
			u.CacheCreation1h = num(cm, "ephemeral_1h_input_tokens")
		}
	}
	return u
}

func parseContent(raw json.RawMessage, rec *Record) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return
	}
	if raw[0] == '"' {
		var s string
		if json.Unmarshal(raw, &s) == nil && s != "" {
			rec.HasText = true
			rec.PromptChars += utf8.RuneCountInString(s)
		}
		return
	}
	var blocks []map[string]json.RawMessage
	if json.Unmarshal(raw, &blocks) != nil {
		return
	}
	for _, b := range blocks {
		switch str(b, "type") {
		case "text":
			rec.HasText = true
			if t := str(b, "text"); t != "" {
				rec.PromptChars += utf8.RuneCountInString(t)
			}
		case "thinking":
			// counted nowhere; text is dropped
		case "tool_use":
			id := str(b, "id")
			name := str(b, "name")
			if id != "" || name != "" {
				rec.ToolUses = append(rec.ToolUses, ToolUse{ID: id, Name: name})
			}
		case "tool_result":
			rec.HasToolRes = true
			rec.ToolResults = append(rec.ToolResults, ToolResult{
				ID:      str(b, "tool_use_id", "toolUseId"),
				IsError: boolVal(b, "is_error", "isError"),
			})
		}
	}
}

func mergeRecord(first, later Record) Record {
	// Resume re-appends old records under the new prompt's id. Keep the first
	// promptId; take any non-empty later value for the rest.
	keepPrompt := first.PromptID
	if later.Type != "" {
		first.Type = later.Type
	}
	if later.ParentUUID != "" {
		first.ParentUUID = later.ParentUUID
	}
	if first.Timestamp.IsZero() && !later.Timestamp.IsZero() {
		first.Timestamp = later.Timestamp
	}
	if later.SessionID != "" {
		first.SessionID = later.SessionID
	}
	if later.CWD != "" {
		first.CWD = later.CWD
	}
	if later.Version != "" {
		first.Version = later.Version
	}
	if later.GitBranch != "" {
		first.GitBranch = later.GitBranch
	}
	if later.RequestID != "" {
		first.RequestID = later.RequestID
	}
	if later.Subtype != "" {
		first.Subtype = later.Subtype
	}
	if later.Title != "" {
		first.Title = later.Title
	}
	if later.Model != "" {
		first.Model = later.Model
	}
	if later.MessageID != "" {
		first.MessageID = later.MessageID
	}
	if later.StopReason != "" {
		first.StopReason = later.StopReason
	}
	if later.Usage.Output >= first.Usage.Output {
		first.Usage = later.Usage
	}
	if later.PromptChars > 0 {
		first.PromptChars = later.PromptChars
		first.HasText = later.HasText
	}
	if later.HasToolRes {
		first.HasToolRes = true
		if len(later.ToolResults) > 0 {
			first.ToolResults = later.ToolResults
		}
	}
	if len(later.ToolUses) > 0 {
		first.ToolUses = later.ToolUses
	}
	first.IsMeta = first.IsMeta || later.IsMeta
	first.IsSidechain = first.IsSidechain || later.IsSidechain
	first.PromptID = keepPrompt
	if first.PromptID == "" {
		first.PromptID = later.PromptID
	}
	return first
}

func str(m map[string]json.RawMessage, keys ...string) string {
	for _, k := range keys {
		v, ok := m[k]
		if !ok {
			continue
		}
		var s string
		if json.Unmarshal(v, &s) == nil {
			return s
		}
	}
	return ""
}

func boolVal(m map[string]json.RawMessage, keys ...string) bool {
	for _, k := range keys {
		v, ok := m[k]
		if !ok {
			continue
		}
		var b bool
		if json.Unmarshal(v, &b) == nil {
			return b
		}
	}
	return false
}

func num(m map[string]json.RawMessage, keys ...string) float64 {
	for _, k := range keys {
		v, ok := m[k]
		if !ok {
			continue
		}
		var f float64
		if json.Unmarshal(v, &f) == nil {
			return f
		}
	}
	return 0
}

func parseTime(s string) time.Time {
	s = strings.TrimSpace(s)
	for _, layout := range []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05.000Z",
		"2006-01-02T15:04:05Z",
		"2006-01-02 15:04:05",
	} {
		if t, err := time.Parse(layout, s); err == nil {
			return t
		}
	}
	return time.Time{}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
