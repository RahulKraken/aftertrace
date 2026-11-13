package harness

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCadencesMatchSources(t *testing.T) {
	root, err := findModRoot()
	if err != nil {
		t.Fatal(err)
	}
	tray, err := os.ReadFile(filepath.Join(root, "desktop/src/tray.js"))
	if err != nil {
		t.Fatal(err)
	}
	engine, err := os.ReadFile(filepath.Join(root, "desktop/src/engine.js"))
	if err != nil {
		t.Fatal(err)
	}
	home, err := os.ReadFile(filepath.Join(root, "web/src/pages/HomePage.tsx"))
	if err != nil {
		t.Fatal(err)
	}
	sess, err := os.ReadFile(filepath.Join(root, "web/src/pages/SessionPage.tsx"))
	if err != nil {
		t.Fatal(err)
	}
	shell, err := os.ReadFile(filepath.Join(root, "web/src/components/Shell.tsx"))
	if err != nil {
		t.Fatal(err)
	}
	mustContain := func(file, want string, blob []byte) {
		t.Helper()
		if !strings.Contains(string(blob), want) {
			t.Errorf("%s: missing %q", file, want)
		}
	}
	mustContain("desktop/src/tray.js", "const OPEN_MS = 12_000", tray)
	mustContain("desktop/src/tray.js", "const IDLE_MS = 45_000", tray)
	mustContain("desktop/src/tray.js", "const HIDDEN_MS = 60_000", tray)
	mustContain("desktop/src/engine.js", "await sleepFn(1000)", engine)
	mustContain("web/src/pages/HomePage.tsx", "visibleMs: live ? 4000 : 30000", home)
	mustContain("web/src/pages/SessionPage.tsx", "visibleMs: 5000", sess)
	mustContain("web/src/components/Shell.tsx", "visibleMs: 15000", shell)

	closed := Cadences[ScenarioClosed]
	if len(closed) != 2 || closed[0].Every != time.Second || closed[1].Every != 60*time.Second {
		t.Fatalf("window_closed: %+v", closed)
	}
	if got := Cadences[ScenarioOpenIdle]; len(got) != 3 || got[0].Every != 15*time.Second || got[1].Every != 30*time.Second || got[2].Every != 45*time.Second {
		t.Fatalf("window_open_idle: %+v", got)
	}
	if got := Cadences[ScenarioLive]; len(got) != 3 || got[0].Every != 4*time.Second || got[1].Every != 5*time.Second || got[2].Every != 12*time.Second {
		t.Fatalf("live: %+v", got)
	}
	for _, p := range closed {
		for _, path := range p.Paths {
			if path == "/api/findings" {
				t.Fatal("window_closed must not poll /api/findings")
			}
		}
	}
}
