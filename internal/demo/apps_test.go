package demo

import "testing"

func TestDemoAppsShape(t *testing.T) {
	apps := buildApps(Seed + 2)
	failed, calls := 0, 0
	for _, s := range apps[0].spans {
		if s.name == "anthropic.messages.create" {
			calls++
			if s.err != "" {
				failed++
			}
		}
	}
	t.Logf("support-bot calls=%d failed=%d spans=%d", calls, failed, len(apps[0].spans))
	if failed*20 < calls {
		t.Fatalf("want at least 5%% failed calls so app.errors fires, got %d of %d", failed, calls)
	}
}
