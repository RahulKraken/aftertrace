package service

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestCommandRoundTrips(t *testing.T) {
	spec := Spec{
		Bin:  "/Users/a b/bin/aftertrace",
		Args: []string{"--db", `/tmp/50% & "x"$HOME\y.duckdb`, "--store-content"},
		Home: "/Users/a b",
		UID:  501,
	}
	want := append([]string{spec.Bin, "serve"}, spec.Args...)
	for _, goos := range []string{"darwin", "linux"} {
		p, err := For(goos, spec)
		if err != nil {
			t.Fatal(err)
		}
		if got := Command(p.Manager, p.Content); !reflect.DeepEqual(got, want) {
			t.Errorf("%s: command = %q, want %q\n%s", goos, got, want, p.Content)
		}
	}
}

func TestPlist(t *testing.T) {
	p, _ := For("darwin", Spec{Bin: "/usr/local/bin/aftertrace", Args: []string{"--store-content"}, Home: "/Users/r", UID: 501})
	if p.Path != "/Users/r/Library/LaunchAgents/dev.aftertrace.plist" {
		t.Errorf("path %s", p.Path)
	}
	for _, s := range []string{
		"<key>RunAtLoad</key>\n\t<true/>",
		"<key>KeepAlive</key>\n\t<true/>",
		"<string>/Users/r/.aftertrace/serve.log</string>",
		"<key>AFTERTRACE_SERVICE</key>\n\t\t<string>launchd</string>",
	} {
		if !strings.Contains(p.Content, s) {
			t.Errorf("plist missing %q", s)
		}
	}
	if got := strings.Join(p.Install[len(p.Install)-1], " "); got != "launchctl bootstrap gui/501 "+p.Path {
		t.Errorf("install ends with %q", got)
	}
}

func TestSystemdUnit(t *testing.T) {
	p, _ := For("linux", Spec{Bin: "/usr/local/bin/aftertrace", Args: []string{"--store-content"}, Home: "/home/r"})
	if p.Path != "/home/r/.config/systemd/user/aftertrace.service" {
		t.Errorf("path %s", p.Path)
	}
	for _, s := range []string{
		"ExecStart=/usr/local/bin/aftertrace serve --store-content\n",
		"Restart=always\n",
		"StandardOutput=append:/home/r/.aftertrace/serve.log\n",
		"Environment=AFTERTRACE_SERVICE=systemd\n",
		"WantedBy=default.target\n",
	} {
		if !strings.Contains(p.Content, s) {
			t.Errorf("unit missing %q", s)
		}
	}
	p, _ = For("linux", Spec{Home: "/home/r", ConfigHome: "/cfg"})
	if p.Path != "/cfg/systemd/user/aftertrace.service" {
		t.Errorf("XDG_CONFIG_HOME path %s", p.Path)
	}
	if _, err := For("windows", Spec{}); err == nil {
		t.Error("windows should be unsupported")
	}
}

func TestResolveBinPrefersHomebrewLink(t *testing.T) {
	prefix := t.TempDir()
	cellar := filepath.Join(prefix, "Cellar", "aftertrace", "0.1.0", "bin", "aftertrace")
	link := filepath.Join(prefix, "bin", "aftertrace")
	if got, _ := ResolveBin(cellar); got != cellar {
		t.Errorf("without the link: %s", got)
	}
	if err := os.MkdirAll(filepath.Dir(link), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(link, nil, 0o755); err != nil {
		t.Fatal(err)
	}
	if got, _ := ResolveBin(cellar); got != link {
		t.Errorf("got %s, want %s", got, link)
	}
	if _, err := ResolveBin("/tmp/go-build123/b001/exe/aftertrace"); err == nil {
		t.Error("go run binary should be refused")
	}
}
