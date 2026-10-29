package history

import (
	"crypto/sha256"
	"encoding/hex"
	"path"
	"strings"
	"time"

	"github.com/RahulKraken/aftertrace/internal/pricing"
	"github.com/RahulKraken/aftertrace/internal/store"
)

const (
	srcHistory = store.HistorySource
	svcName    = "claude-code"
)

type sessionOut struct {
	SessionID string
	Turns     int
	Requests  int
	Spans     []store.Span
	Events    []store.Event
}

// Convert turns parsed records into the store's Claude Code span/event shape
// so views, cost breakdowns and rules can read them. Nothing in the batch is
// prompt or response text.
func Convert(sessionID string, recs []Record, subagent bool) sessionOut {
	if sid := firstSessionID(recs, sessionID); sid != "" {
		sessionID = sid
	}
	if sessionID == "" || len(recs) == 0 {
		return sessionOut{SessionID: sessionID}
	}
	cwd, version := firstMeta(recs)
	project := projectName(cwd)
	title := lastTitle(recs)
	turns := groupTurns(recs, subagent)

	res := resource(version)
	out := sessionOut{SessionID: sessionID}
	for i, t := range turns {
		key := t.key
		if key == "" {
			key = itoa(i)
		}
		trace := hid(32, "hist", sessionID, "turn", key)
		ix := hid(16, "hist", sessionID, "ix", key)
		start, end := t.bounds()
		if start == 0 {
			continue
		}
		ixAttrs := map[string]any{
			"session.id":              sessionID,
			"span.type":               "claude_code.interaction",
			"app.entrypoint":          "cli",
			"interaction.sequence":    i + 1,
			"interaction.duration_ms": float64(end-start) / 1e6,
		}
		if project != "" {
			ixAttrs["vcs.repository.name"] = project
		}
		if title != "" && i == 0 {
			ixAttrs["session.title"] = title
		}
		if t.promptLen > 0 {
			ixAttrs["user_prompt_length"] = t.promptLen
		}
		out.Spans = append(out.Spans, store.Span{
			TraceID: trace, SpanID: ix, Name: "claude_code.interaction",
			StartNS: start, EndNS: end, DurationMS: float64(end-start) / 1e6,
			SessionID: sessionID, Attrs: ixAttrs, Resource: res,
		})
		out.Turns++
		if t.promptLen > 0 {
			out.Events = append(out.Events, store.Event{
				TsNS: start, Name: "user_prompt", SessionID: sessionID,
				PromptID: t.promptID, TraceID: trace, SpanID: ix,
				Attrs:    map[string]any{"prompt_length": t.promptLen, "event.name": "user_prompt"},
				Resource: res,
			})
		}
		qs := "main"
		if subagent {
			qs = "subagent"
		}
		var mcpServer, mcpTool string
		for _, call := range t.calls {
			reqID := call.requestID
			if reqID == "" {
				reqID = call.messageID
			}
			if reqID == "" {
				reqID = hid(16, "hist", sessionID, "req", call.key)
			}
			spanID := hid(16, "hist", sessionID, "llm", call.key)
			cs, ce := call.start, call.end
			if ce <= cs {
				ce = cs + 1e6
			}
			llmAttrs := map[string]any{
				"session.id":            sessionID,
				"span.type":             "claude_code.llm_request",
				"model":                 call.model,
				"request_id":            reqID,
				"input_tokens":          call.usage.Input,
				"output_tokens":         call.usage.Output,
				"cache_read_tokens":     call.usage.CacheRead,
				"cache_creation_tokens": call.cacheWriteTokens(),
				"attempt":               1,
				"success":               true,
				"query_source_safe":     qs,
			}
			if call.stop != "" {
				llmAttrs["stop_reason"] = call.stop
			}
			if project != "" {
				llmAttrs["vcs.repository.name"] = project
			}
			if subagent {
				llmAttrs["agent_id"] = "subagent"
			}
			out.Spans = append(out.Spans, store.Span{
				TraceID: trace, SpanID: spanID, ParentSpanID: ix,
				Name:    "claude_code.llm_request",
				StartNS: cs, EndNS: ce, DurationMS: float64(ce-cs) / 1e6,
				SessionID: sessionID, Attrs: llmAttrs, Resource: res,
			})
			evAttrs := map[string]any{
				"event.name":            "api_request",
				"model":                 call.model,
				"request_id":            reqID,
				"input_tokens":          call.usage.Input,
				"output_tokens":         call.usage.Output,
				"cache_read_tokens":     call.usage.CacheRead,
				"cache_creation_tokens": call.cacheWriteTokens(),
				"query_source":          qs,
			}
			if usd, ok := pricing.Cost(call.model, call.usage.Input, call.usage.Output, call.usage.CacheRead, call.usage.CacheCreation, call.usage.CacheCreation5m, call.usage.CacheCreation1h); ok {
				evAttrs["cost_usd"] = usd
				evAttrs["cost_estimated"] = true
			}
			if mcpServer != "" {
				evAttrs["mcp_server.name"] = mcpServer
				evAttrs["mcp_tool.name"] = mcpTool
			}
			out.Events = append(out.Events, store.Event{
				TsNS: cs, Name: "api_request", SessionID: sessionID,
				PromptID: t.promptID, TraceID: trace, SpanID: spanID, RequestID: reqID,
				Attrs: evAttrs, Resource: res,
			})
			out.Requests++
			mcpServer, mcpTool = "", ""
			for _, tu := range call.tools {
				if name := tu.Name; strings.HasPrefix(name, "mcp__") {
					parts := strings.Split(name, "__")
					if len(parts) >= 3 {
						mcpServer, mcpTool = parts[1], parts[2]
					}
				}
				toolID := hid(16, "hist", sessionID, "tool", tu.ID)
				ts, te := cs, ce
				tr, hasRes := t.results[tu.ID]
				if hasRes && tr.at > ts {
					te = tr.at
				}
				if te <= ts {
					te = ts + 1e6
				}
				toolAttrs := map[string]any{
					"session.id":  sessionID,
					"span.type":   "claude_code.tool",
					"tool_name":   tu.Name,
					"tool_use_id": tu.ID,
				}
				if hasRes && tr.tokens > 0 {
					toolAttrs["result_tokens"] = tr.tokens
				}
				if project != "" {
					toolAttrs["vcs.repository.name"] = project
				}
				out.Spans = append(out.Spans, store.Span{
					TraceID: trace, SpanID: toolID, ParentSpanID: ix,
					Name:    "claude_code.tool",
					StartNS: ts, EndNS: te, DurationMS: float64(te-ts) / 1e6,
					SessionID: sessionID, Attrs: toolAttrs, Resource: res,
				})
				execID := hid(16, "hist", sessionID, "exec", tu.ID)
				err := hasRes && tr.err
				execAttrs := map[string]any{
					"session.id":  sessionID,
					"span.type":   "claude_code.tool.execution",
					"tool_use_id": tu.ID,
					"success":     !err,
				}
				out.Spans = append(out.Spans, store.Span{
					TraceID: trace, SpanID: execID, ParentSpanID: toolID,
					Name:    "claude_code.tool.execution",
					StartNS: ts, EndNS: te, DurationMS: float64(te-ts) / 1e6,
					IsError: err, SessionID: sessionID, Attrs: execAttrs, Resource: res,
				})
			}
		}
		if t.compactNS > 0 {
			out.Events = append(out.Events, store.Event{
				TsNS: t.compactNS, Name: "compaction", SessionID: sessionID,
				PromptID: t.promptID, TraceID: trace, SpanID: ix,
				Attrs:    map[string]any{"event.name": "compaction", "trigger": "auto", "success": "true"},
				Resource: res,
			})
		}
	}
	return out
}

func resource(version string) map[string]any {
	r := map[string]any{
		"service.name":      svcName,
		"aftertrace.source": srcHistory,
	}
	if version != "" {
		r["service.version"] = version
		r["app.version"] = version
	}
	return r
}

type turn struct {
	key       string
	promptID  string
	promptLen int
	start     int64
	end       int64
	compactNS int64
	calls     []llmCall
	byMsg     map[string]int
	results   map[string]toolEnd
}

type llmCall struct {
	key       string
	messageID string
	requestID string
	model     string
	stop      string
	usage     Usage
	start     int64
	end       int64
	tools     []ToolUse
}

type toolEnd struct {
	at     int64
	err    bool
	tokens int
}

func (c llmCall) cacheWriteTokens() float64 {
	if c.usage.CacheCreation5m != 0 || c.usage.CacheCreation1h != 0 {
		return c.usage.CacheCreation5m + c.usage.CacheCreation1h
	}
	return c.usage.CacheCreation
}

func (t *turn) bounds() (int64, int64) {
	lo, hi := t.start, t.end
	for _, c := range t.calls {
		if lo == 0 || (c.start > 0 && c.start < lo) {
			lo = c.start
		}
		if c.end > hi {
			hi = c.end
		}
	}
	if hi <= lo {
		hi = lo + 1e6
	}
	return lo, hi
}

func groupTurns(recs []Record, subagent bool) []*turn {
	var turns []*turn
	var cur *turn
	seenPrompt := map[string]bool{}
	seenMsg := map[string]bool{} // message.id already billed
	open := func(rec Record, key string) *turn {
		t := &turn{
			key:      key,
			promptID: rec.PromptID,
			start:    ns(rec.Timestamp),
			byMsg:    map[string]int{},
			results:  map[string]toolEnd{},
		}
		turns = append(turns, t)
		return t
	}
	for _, rec := range recs {
		at := ns(rec.Timestamp)
		switch rec.Type {
		case "ai-title":
			continue
		case "system":
			if rec.Subtype == "compact_boundary" && cur != nil {
				cur.compactNS = at
				if at > cur.end {
					cur.end = at
				}
			}
		case "user":
			if rec.IsMeta {
				continue
			}
			if rec.HasToolRes {
				if cur != nil {
					for _, tr := range rec.ToolResults {
						if tr.ID != "" {
							cur.results[tr.ID] = toolEnd{at: at, err: tr.IsError, tokens: tr.ResultTokens}
						}
					}
					if at > cur.end {
						cur.end = at
					}
				}
				continue
			}
			if !rec.HasText && rec.PromptChars == 0 {
				continue
			}
			if rec.PromptID != "" && seenPrompt[rec.PromptID] {
				continue
			}
			if rec.PromptID != "" {
				seenPrompt[rec.PromptID] = true
			}
			key := rec.PromptID
			if key == "" {
				key = rec.UUID
			}
			cur = open(rec, key)
			cur.promptLen = rec.PromptChars
			if at > cur.end {
				cur.end = at
			}
		case "assistant":
			if rec.IsMeta {
				continue
			}
			msgKey := rec.MessageID
			if msgKey == "" {
				msgKey = rec.RequestID
			}
			if msgKey == "" {
				msgKey = rec.UUID
			}
			if cur == nil {
				cur = open(rec, msgKey)
			}
			if at > cur.end {
				cur.end = at
			}
			if i, ok := cur.byMsg[msgKey]; ok {
				c := &cur.calls[i]
				if rec.Usage.Output >= c.usage.Output {
					c.usage = rec.Usage
					c.model = firstNonEmpty(rec.Model, c.model)
					c.stop = firstNonEmpty(rec.StopReason, c.stop)
					c.requestID = firstNonEmpty(rec.RequestID, c.requestID)
				}
				if at > c.end {
					c.end = at
				}
				if at > 0 && (c.start == 0 || at < c.start) {
					c.start = at
				}
				if len(rec.ToolUses) > 0 {
					c.tools = rec.ToolUses
				}
				continue
			}
			if rec.MessageID != "" && seenMsg[rec.MessageID] {
				// Same API reply written under another uuid already counted.
				continue
			}
			if rec.MessageID != "" {
				seenMsg[rec.MessageID] = true
			}
			call := llmCall{
				key:       msgKey,
				messageID: rec.MessageID,
				requestID: rec.RequestID,
				model:     rec.Model,
				stop:      rec.StopReason,
				usage:     rec.Usage,
				start:     at,
				end:       at,
				tools:     rec.ToolUses,
			}
			cur.byMsg[msgKey] = len(cur.calls)
			cur.calls = append(cur.calls, call)
		}
		_ = subagent
	}
	return turns
}

func firstSessionID(recs []Record, fallback string) string {
	for _, r := range recs {
		if r.SessionID != "" {
			return r.SessionID
		}
	}
	return fallback
}

func firstMeta(recs []Record) (cwd, version string) {
	for _, r := range recs {
		if cwd == "" && r.CWD != "" {
			cwd = r.CWD
		}
		if version == "" && r.Version != "" {
			version = r.Version
		}
		if cwd != "" && version != "" {
			break
		}
	}
	return cwd, version
}

func lastTitle(recs []Record) string {
	var t string
	for _, r := range recs {
		if r.Type == "ai-title" && r.Title != "" {
			t = r.Title
		}
	}
	return t
}

func projectName(cwd string) string {
	cwd = strings.TrimRight(cwd, `/\`)
	if cwd == "" {
		return ""
	}
	base := path.Base(strings.ReplaceAll(cwd, `\`, `/`))
	if base == "." || base == "/" || base == "" {
		return ""
	}
	return base
}

func ns(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.UnixNano()
}

func hid(n int, parts ...string) string {
	h := sha256.New()
	for i, p := range parts {
		if i > 0 {
			h.Write([]byte{0})
		}
		h.Write([]byte(p))
	}
	sum := h.Sum(nil)
	if n/2 > len(sum) {
		n = len(sum) * 2
	}
	return hex.EncodeToString(sum[:n/2])
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
