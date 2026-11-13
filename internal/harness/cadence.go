package harness

import "time"

// Scenario is a client shape the harness stands in for. B1 is window_closed.
const (
	ScenarioClosed   = "window_closed"
	ScenarioOpenIdle = "window_open_idle"
	ScenarioLive     = "live"
	ScenarioNone     = "none"
)

// Poll is one client timer: GET these paths, in order, on this cadence.
type Poll struct {
	Name  string
	Every time.Duration
	Paths []string
}

// Cadences are the real desktop/web timers. WINDOW CLOSED is the B1 gate:
// supervisor /api/health every 1s (desktop/src/engine.js), tray health then
// glance every 60s (HIDDEN_MS). Findings are never polled; they refresh as a
// side effect of glance/status/overview/session, at most every 30s.
var Cadences = map[string][]Poll{
	ScenarioClosed: {
		{Name: "supervisor_health", Every: time.Second, Paths: []string{"/api/health"}},
		{Name: "tray_hidden", Every: 60 * time.Second, Paths: []string{"/api/health", "/api/glance"}},
	},
	ScenarioOpenIdle: {
		{Name: "status", Every: 15 * time.Second, Paths: []string{"/api/status"}},
		{Name: "home", Every: 30 * time.Second, Paths: []string{"/api/overview", "/api/sessions"}},
		{Name: "tray_idle", Every: 45 * time.Second, Paths: []string{"/api/health", "/api/glance"}},
	},
	// Live is the session page: Shell still polls status every 15s, the
	// session body polls /api/session/{id} every 5s, tray popover 12s.
	// Home is not polled at the same time (the real UI shows one page).
	ScenarioLive: {
		{Name: "status", Every: 15 * time.Second, Paths: []string{"/api/status"}},
		{Name: "session", Every: 5 * time.Second, Paths: []string{"/api/session/{id}"}},
		{Name: "popover", Every: 12 * time.Second, Paths: []string{"/api/health", "/api/glance"}},
	},
}

// IsolationEndpoints are the 2-minute (or CI-short) one-route CPU windows.
var IsolationEndpoints = []struct {
	Name string
	Path string
}{
	{Name: "health", Path: "/api/health"},
	{Name: "glance", Path: "/api/glance"},
	{Name: "status", Path: "/api/status"},
	{Name: "overview", Path: "/api/overview"},
	{Name: "sessions", Path: "/api/sessions"},
}

const settleAfterWarm = 3 * time.Second
