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
		{"", ""},
	}
	for _, c := range cases {
		if got := cleanPrompt(c.in); got != c.want {
			t.Errorf("cleanPrompt(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
