package api

import "testing"

func TestCleanPrompt(t *testing.T) {
	cases := []struct{ in, want string }{
		{"fix the  login\nbug", "fix the login bug"},
		{"<pasted_content id=\"x\">hello</pasted_content> world", "hello world"},
		{"<system-reminder>\nLinked sessions now: a = b\n</system-reminder>\n\nBackground: add a service command", "Background: add a service command"},
		{"<system-reminder>one</system-reminder><system-reminder>two</system-reminder>", "Automated message"},
		{"<task-notification><task-id>b1</task-id></task-notification>", "Background task finished"},
		{"<system-reminder>x</system-reminder><side-sessions-event>None working</side-sessions-event>", "Update from a side session"},
		{"<system-reminder>\nLinked sessions now: a = b (done, PR #5); c", "Automated message"},
		{"Fix it <system-reminder>clipped", "Fix it"},
		{"Background (from the session that started this one): Aftertrace is a profiler.", "Aftertrace is a profiler."},
		{"", ""},
	}
	for _, c := range cases {
		if got := cleanPrompt(c.in); got != c.want {
			t.Errorf("cleanPrompt(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestDoing(t *testing.T) {
	cases := []struct {
		name string
		a    map[string]any
		want string
	}{
		{"claude_code.tool", map[string]any{"tool_name": "Bash", "full_command": "npm test -- --watch=false\necho done"}, "Running npm test -- --watch=false"},
		{"claude_code.tool", map[string]any{"tool_name": "Read", "file_path": "/repo/internal/api/sessions.go"}, "Reading sessions.go"},
		{"claude_code.tool", map[string]any{"tool_name": "mcp__Claude_Browser__browser_batch"}, "Browser batch · Claude Browser"},
		{"claude_code.tool", map[string]any{"tool_name": "AskUserQuestion"}, "Waiting for your answer"},
		{"claude_code.tool.blocked_on_user", nil, "Waiting for your approval"},
		{"claude_code.llm_request", map[string]any{"model": "claude-opus-5-5"}, "Thinking · Opus 5.5"},
		{"claude_code.llm_request", map[string]any{"model": "claude-sonnet-4-5-20250929"}, "Thinking · Sonnet 4.5"},
	}
	for _, c := range cases {
		if got := doing(c.name, c.a); got != c.want {
			t.Errorf("doing(%q, %v) = %q, want %q", c.name, c.a, got, c.want)
		}
	}
}
