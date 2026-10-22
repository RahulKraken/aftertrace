// Package service writes and removes the per-user login service that keeps
// `aftertrace serve` running: a LaunchAgent on macOS, a systemd --user unit on
// Linux. It only builds file contents and command lines; cmd/aftertrace runs
// them and prints each one first.
package service

import (
	"encoding/xml"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	Label  = "dev.aftertrace"     // launchd label
	Unit   = "aftertrace.service" // systemd unit name
	EnvVar = "AFTERTRACE_SERVICE" // set in the service's environment to "launchd" or "systemd"
)

// Spec is the command the service runs.
type Spec struct {
	Bin  string   // absolute path to aftertrace
	Args []string // flags for `aftertrace serve`
	Home string   // the user's home directory
	UID  int      // for the launchd gui/<uid> domain
	// ConfigHome is $XDG_CONFIG_HOME, or empty for ~/.config. Linux only.
	ConfigHome string
}

// LogPath is where the service's stdout and stderr go.
func (s Spec) LogPath() string { return filepath.Join(s.Home, ".aftertrace", "serve.log") }

// Plan is everything install, uninstall and status do on one platform.
type Plan struct {
	Manager   string // "launchd" or "systemd"
	Path      string // the file install writes
	Content   string
	Install   [][]string // run after writing Path
	Uninstall [][]string // run before removing Path; failures are ignored
	Status    []string
	// Stop unloads a running service before install rewrites it. launchd
	// will not re-read a loaded plist; systemd restarts in Install instead.
	Stop []string
}

// For returns the plan for goos, or an error on platforms without one.
func For(goos string, s Spec) (Plan, error) {
	switch goos {
	case "darwin":
		domain := fmt.Sprintf("gui/%d", s.UID)
		path := filepath.Join(s.Home, "Library", "LaunchAgents", Label+".plist")
		return Plan{
			Manager: "launchd",
			Path:    path,
			Content: Plist(s),
			Stop:    []string{"launchctl", "bootout", domain + "/" + Label},
			Install: [][]string{
				{"launchctl", "enable", domain + "/" + Label},
				{"launchctl", "bootstrap", domain, path},
			},
			Uninstall: [][]string{{"launchctl", "bootout", domain + "/" + Label}},
			Status:    []string{"launchctl", "print", domain + "/" + Label},
		}, nil
	case "linux":
		cfg := s.ConfigHome
		if cfg == "" {
			cfg = filepath.Join(s.Home, ".config")
		}
		return Plan{
			Manager: "systemd",
			Path:    filepath.Join(cfg, "systemd", "user", Unit),
			Content: SystemdUnit(s),
			Install: [][]string{
				{"systemctl", "--user", "daemon-reload"},
				{"systemctl", "--user", "enable", Unit},
				{"systemctl", "--user", "restart", Unit},
			},
			Uninstall: [][]string{
				{"systemctl", "--user", "disable", "--now", Unit},
				{"systemctl", "--user", "daemon-reload"},
			},
			Status: []string{"systemctl", "--user", "show", Unit, "--property=LoadState,ActiveState,SubState,MainPID"},
		}, nil
	}
	return Plan{}, fmt.Errorf("aftertrace service supports macOS (launchd) and Linux (systemd), not %s", goos)
}

// Plist is the LaunchAgent: start at login, restart if it exits.
func Plist(s Spec) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>` + Label + `</string>
	<key>ProgramArguments</key>
	<array>
`)
	for _, a := range append([]string{s.Bin, "serve"}, s.Args...) {
		b.WriteString("\t\t<string>" + xmlEscape(a) + "</string>\n")
	}
	log := xmlEscape(s.LogPath())
	b.WriteString(`	</array>
	<key>EnvironmentVariables</key>
	<dict>
		<key>` + EnvVar + `</key>
		<string>launchd</string>
	</dict>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>` + log + `</string>
	<key>StandardErrorPath</key>
	<string>` + log + `</string>
</dict>
</plist>
`)
	return b.String()
}

// SystemdUnit is the --user unit: start with the user manager, restart if it exits.
func SystemdUnit(s Spec) string {
	args := []string{systemdQuote(s.Bin), "serve"}
	for _, a := range s.Args {
		args = append(args, systemdQuote(a))
	}
	log := strings.ReplaceAll(s.LogPath(), "%", "%%")
	return `[Unit]
Description=Aftertrace, a local profiler for Claude Code and AI apps
Documentation=https://github.com/RahulKraken/aftertrace/blob/main/docs/cli.md#aftertrace-service

[Service]
ExecStart=` + strings.Join(args, " ") + `
Environment=` + EnvVar + `=systemd
Restart=always
RestartSec=5
StandardOutput=append:` + log + `
StandardError=append:` + log + `

[Install]
WantedBy=default.target
`
}

// Command reads back the command line from a file Plist or SystemdUnit wrote.
func Command(manager, content string) []string {
	if manager == "systemd" {
		for _, line := range strings.Split(content, "\n") {
			if rest, ok := strings.CutPrefix(line, "ExecStart="); ok {
				return systemdSplit(rest)
			}
		}
		return nil
	}
	// The first <array> in the plist is ProgramArguments.
	d := xml.NewDecoder(strings.NewReader(content))
	var out []string
	in := false
	for {
		tok, err := d.Token()
		if err != nil {
			return out
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if t.Name.Local == "array" {
				in = true
			} else if in && t.Name.Local == "string" {
				var v string
				if d.DecodeElement(&v, &t) == nil {
					out = append(out, v)
				}
			}
		case xml.EndElement:
			if t.Name.Local == "array" {
				return out
			}
		}
	}
}

// ResolveBin picks the path the service should run. A Homebrew install runs
// from Cellar/aftertrace/<version>/bin, which goes away on upgrade, so prefer
// the stable <prefix>/bin/aftertrace link next to it.
func ResolveBin(exe string) (string, error) {
	if strings.Contains(exe, string(filepath.Separator)+"go-build") {
		return "", fmt.Errorf("%s looks like a `go run` binary that will be deleted; install aftertrace first", exe)
	}
	if i := strings.Index(exe, "/Cellar/aftertrace/"); i >= 0 {
		link := exe[:i] + "/bin/aftertrace"
		if _, err := os.Stat(link); err == nil {
			return link, nil
		}
	}
	return exe, nil
}

func xmlEscape(s string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

// systemdQuote quotes one ExecStart word. systemd expands % specifiers and $
// variables, so both are doubled.
func systemdQuote(s string) string {
	s = strings.NewReplacer("%", "%%", "$", "$$").Replace(s)
	if s != "" && !strings.ContainsAny(s, " \t\"'\\;") {
		return s
	}
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) + `"`
}

func systemdSplit(line string) []string {
	var out []string
	var cur strings.Builder
	inQuote, have := false, false
	for i := 0; i < len(line); i++ {
		c := line[i]
		switch {
		case c == '\\' && inQuote && i+1 < len(line):
			i++
			cur.WriteByte(line[i])
		case c == '"':
			inQuote, have = !inQuote, true
		case (c == ' ' || c == '\t') && !inQuote:
			if have {
				out = append(out, cur.String())
				cur.Reset()
				have = false
			}
		default:
			cur.WriteByte(c)
			have = true
		}
	}
	if have {
		out = append(out, cur.String())
	}
	for i, a := range out {
		out[i] = strings.NewReplacer("%%", "%", "$$", "$").Replace(a)
	}
	return out
}
