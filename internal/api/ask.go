package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/RahulKraken/aftertrace/internal/query"
)

var askQuestions = []string{
	"Where did my money go this week?",
	"Which tools wait on me for approval the most?",
	"What was my slowest turn and why?",
	"How much did API retries cost me in time?",
	"Which model do I use most, and what does it cost per turn?",
	"Which MCP server returns the most tokens?",
}

func (s *Server) getAskSuggestions(w http.ResponseWriter, r *http.Request) {
	agent := "off. Start aftertrace serve with --ask and set ANTHROPIC_API_KEY to turn it on."
	if s.Ask != nil {
		agent = s.Ask.Model + " via the Anthropic API. Sends the schema and query results (long strings cut), never raw traces."
	}
	schema := schemaText(s.db())
	s.json(w, map[string]any{"agent": agent, "enabled": s.Ask != nil, "questions": askQuestions, "schema": schema}, 200)
}

func (s *Server) postAsk(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Question string `json:"question"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil || strings.TrimSpace(body.Question) == "" {
		s.err(w, fmt.Errorf("question is required"), 400)
		return
	}
	if s.Ask == nil {
		s.json(w, map[string]any{
			"answer":   "Ask is off. Start aftertrace serve with --ask and set ANTHROPIC_API_KEY. It sends the schema and query results to the Anthropic API; nothing else leaves this machine.",
			"enabled":  false,
			"sql":      nil,
			"result":   nil,
			"evidence": []any{},
			"builder":  nil,
		}, 200)
		return
	}
	schema := schemaText(s.db())
	run := func(q string) (*query.SQLResult, error) {
		return query.RunSQL(s.db(), q, 500)
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
	defer cancel()
	res, err := s.Ask.Ask(ctx, body.Question, schema, run)
	if err != nil {
		s.err(w, err, 502)
		return
	}
	ev := evidenceFor(s.db(), res.TraceIDs)
	var sqlText any
	if res.SQL != "" {
		sqlText = res.SQL
	}
	s.json(w, map[string]any{
		"answer":   res.Answer,
		"enabled":  true,
		"sql":      sqlText,
		"result":   res.Result,
		"evidence": ev,
		"builder":  nil,
		"steps":    res.Steps,
		"model":    res.Model,
	}, 200)
}

// evidenceFor labels the turns the model cited. Unknown ids are dropped.
func evidenceFor(db *sql.DB, ids []string) []map[string]any {
	out := []map[string]any{}
	for _, id := range ids {
		if len(out) == 5 {
			break
		}
		var span string
		var dur float64
		if err := db.QueryRow(`SELECT span_id, duration_ms FROM turn_roots WHERE trace_id=? LIMIT 1`, id).Scan(&span, &dur); err != nil {
			continue
		}
		label := fmt.Sprintf("turn, %.1fs", dur/1000)
		if p, err := turnPrompt(db, id); err == nil && p.Valid {
			label = clipLabel(p.String) + " · " + fmt.Sprintf("%.1fs", dur/1000)
		}
		out = append(out, map[string]any{"trace_id": id, "span_id": span, "label": label})
	}
	return out
}

// markup matches wrapper tags clients put around pasted or injected text,
// such as <pasted_content id="..."> and </pasted_content>.
var markup = regexp.MustCompile(`</?[A-Za-z_][\w-]*(\s[^<>]*)?>`)

// injected matches blocks a client adds to a prompt that the person did not
// type: reminders, background-task and side-session notices, CI events.
var injected = regexp.MustCompile(`(?s)<(system-reminder|task-notification|side-sessions-event|ci-monitor-event|local-command-caveat)\b[^>]*>.*?</(system-reminder|task-notification|side-sessions-event|ci-monitor-event|local-command-caveat)>`)

var unclosed = regexp.MustCompile(`(?s)<(system-reminder|task-notification|side-sessions-event|ci-monitor-event|local-command-caveat)\b.*$`)

// cleanPrompt is prompt text for labels: injected blocks dropped, wrapper tags
// removed, whitespace collapsed. A prompt that was nothing but injected text
// gets a short description of what sent it.
func cleanPrompt(s string) string {
	stripped := injected.ReplaceAllString(s, " ")
	// A prompt clipped mid-block leaves an injected block with no closing tag.
	stripped = unclosed.ReplaceAllString(stripped, " ")
	out := strings.Join(strings.Fields(markup.ReplaceAllString(stripped, " ")), " ")
	// Side sessions open with Claude Code's own preamble; the brief comes after it.
	out = strings.TrimSpace(strings.TrimPrefix(out, "Background (from the session that started this one):"))
	if out != "" || strings.TrimSpace(s) == "" {
		return out
	}
	switch {
	case strings.Contains(s, "<task-notification"):
		return "Background task finished"
	case strings.Contains(s, "<side-sessions-event"):
		return "Update from a side session"
	case strings.Contains(s, "<ci-monitor-event"):
		return "CI update"
	}
	return "Automated message"
}

func clipLabel(s string) string {
	s = cleanPrompt(s)
	if len([]rune(s)) > 60 {
		return string([]rune(s)[:59]) + "…"
	}
	return s
}

// schemaText describes the store for the Ask model and the Query page: every
// table and view with its columns, plus the span and event names present.
func schemaText(db *sql.DB) string {
	var b strings.Builder
	b.WriteString("Tables and views (DuckDB). attrs and resource are JSON; read them with a(json, key) for strings and n(json, key) for numbers.\n")
	rel := []struct{ name, note string }{
		{"spans", "every span. name is e.g. claude_code.interaction (one turn), claude_code.llm_request, claude_code.tool"},
		{"span_events", "events on spans: gen_ai.request.attempt (retries), tool.output"},
		{"events", "log events: api_request (cost_usd per request), tool_decision, tool_result, user_prompt, compaction, hook_execution_complete"},
		{"metric_points", "metrics, e.g. claude_code.cost.usage, claude_code.token.usage, claude_code.lines_of_code.count, claude_code.active_time.total"},
		{"llm", "one row per model request with cost_usd, tokens, ttft_ms, attempt, model, effort, skill_name, agent_name, mcp_server_name, repo"},
		{"tools", "one row per tool call with tool_name, wait_ms (blocked on the user), exec_ms, decision, decision_source, result_tokens"},
		{"turn_roots", "one row per turn (trace_id, session_id, start_ns, end_ns, duration_ms, in_progress)"},
	}
	for _, r := range rel {
		rows, err := db.Query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name=? ORDER BY ordinal_position`, r.name)
		if err != nil {
			continue
		}
		var cols []string
		for rows.Next() {
			var c, t string
			if rows.Scan(&c, &t) == nil {
				cols = append(cols, c+" "+strings.ToLower(t))
			}
		}
		rows.Close()
		fmt.Fprintf(&b, "\n%s(%s)\n  -- %s\n", r.name, strings.Join(cols, ", "), r.note)
	}
	for _, q := range []struct{ label, sql string }{
		{"Span names present", `SELECT name, count(*) FROM spans GROUP BY 1 ORDER BY 2 DESC LIMIT 25`},
		{"Event names present", `SELECT name, count(*) FROM events GROUP BY 1 ORDER BY 2 DESC LIMIT 25`},
	} {
		rows, err := db.Query(q.sql)
		if err != nil {
			continue
		}
		var parts []string
		for rows.Next() {
			var n string
			var c int64
			if rows.Scan(&n, &c) == nil {
				parts = append(parts, fmt.Sprintf("%s (%d)", n, c))
			}
		}
		rows.Close()
		if len(parts) > 0 {
			fmt.Fprintf(&b, "\n%s: %s\n", q.label, strings.Join(parts, ", "))
		}
	}
	return b.String()
}
