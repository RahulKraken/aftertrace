package main

import (
	"errors"
	"flag"
	"fmt"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/RahulKraken/aftertrace/internal/service"
)

const serviceUsage = `usage: aftertrace service install [--dry-run] [serve flags]
       aftertrace service uninstall [--dry-run]
       aftertrace service status`

func cmdService(args []string) int {
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, serviceUsage)
		return 2
	}
	switch args[0] {
	case "install":
		return serviceInstall(args[1:])
	case "uninstall":
		return serviceUninstall(args[1:])
	case "status":
		return serviceStatus(args[1:])
	}
	fmt.Fprintf(os.Stderr, "unknown service command %q\n%s\n", args[0], serviceUsage)
	return 2
}

// servicePlan builds the plan for this machine with the given serve flags.
func servicePlan(serveArgs []string) (service.Plan, service.Spec, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return service.Plan{}, service.Spec{}, err
	}
	exe, err := os.Executable()
	if err != nil {
		return service.Plan{}, service.Spec{}, err
	}
	bin, err := service.ResolveBin(exe)
	if err != nil {
		return service.Plan{}, service.Spec{}, err
	}
	spec := service.Spec{Bin: bin, Args: serveArgs, Home: home, UID: os.Getuid(), ConfigHome: os.Getenv("XDG_CONFIG_HOME")}
	plan, err := service.For(runtime.GOOS, spec)
	return plan, spec, err
}

func serviceInstall(args []string) int {
	fs := flag.NewFlagSet("service install", flag.ExitOnError)
	dry := fs.Bool("dry-run", false, "print the file and commands without writing or running anything")
	f := addServeFlags(fs)
	_ = fs.Parse(args)
	if fs.NArg() > 0 {
		fmt.Fprintln(os.Stderr, serviceUsage)
		return 2
	}
	if *f.ask {
		fmt.Fprintln(os.Stderr, "--ask needs ANTHROPIC_API_KEY, which a login service does not inherit from your shell. Run `aftertrace serve --ask` by hand instead.")
		return 1
	}

	// Pass on only the flags given, so the service follows serve's defaults.
	var serveArgs []string
	fs.Visit(func(fl *flag.Flag) {
		switch fl.Name {
		case "dry-run":
			return
		case "db":
			// The service starts in /, so a relative path would land there.
			if abs, err := filepath.Abs(fl.Value.String()); err == nil {
				serveArgs = append(serveArgs, "--db", abs)
				return
			}
		}
		if b, ok := fl.Value.(interface{ IsBoolFlag() bool }); ok && b.IsBoolFlag() {
			if fl.Value.String() == "true" {
				serveArgs = append(serveArgs, "--"+fl.Name)
			}
			return
		}
		serveArgs = append(serveArgs, "--"+fl.Name, fl.Value.String())
	})

	plan, spec, err := servicePlan(serveArgs)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}

	// A loaded LaunchAgent has to be unloaded before it reads the new file.
	// A fresh install needs the ports free, or the service would fail and
	// restart forever.
	var cmds [][]string
	state := serviceRunning(plan)
	if state != "" && plan.Stop != nil {
		cmds = append(cmds, plan.Stop)
	}
	cmds = append(cmds, plan.Install...)
	if !strings.HasPrefix(state, "running") {
		if err := portsFree(f); err != nil {
			if !*dry {
				fmt.Fprintln(os.Stderr, err)
				return 1
			}
			fmt.Printf("Note: %v\n\n", err)
		}
	}

	mkdir, verb, run := "Creating directory", "Writing", "Running"
	if *dry {
		mkdir, verb, run = "Would create directory", "Would write", "Would run"
	}
	var dirs []string
	for _, d := range []string{filepath.Dir(spec.LogPath()), filepath.Dir(plan.Path)} {
		if _, err := os.Stat(d); errors.Is(err, os.ErrNotExist) {
			dirs = append(dirs, d)
		}
	}
	for _, d := range dirs {
		fmt.Printf("%s %s\n", mkdir, d)
	}
	fmt.Printf("%s %s:\n\n%s\n%s:\n", verb, plan.Path, plan.Content, run)
	for _, c := range cmds {
		fmt.Println("  " + strings.Join(c, " "))
	}
	if *dry {
		return 0
	}
	fmt.Println()

	for _, d := range dirs {
		if err := os.MkdirAll(d, 0o755); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
	}
	if err := os.WriteFile(plan.Path, []byte(plan.Content), 0o644); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	for i, c := range cmds {
		err := runCmd(c)
		if i == 0 && state != "" && plan.Stop != nil {
			// A job that was already on its way out fails bootout with "No
			// such process", which is fine. bootout also returns before
			// launchd forgets the job, and bootstrap fails with
			// "Input/output error" until it has.
			for end := time.Now().Add(15 * time.Second); serviceRunning(plan) != "" && time.Now().Before(end); {
				time.Sleep(250 * time.Millisecond)
			}
			continue
		}
		if err != nil {
			fmt.Fprintf(os.Stderr, "%s: %v\n", strings.Join(c, " "), err)
			return 1
		}
	}

	host := *f.listen
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	ui := net.JoinHostPort(host, strconv.Itoa(*f.uiPort))
	if waitDial(ui, 20*time.Second) {
		fmt.Printf("Aftertrace is running at http://%s and will start again at login.\n", ui)
	} else {
		fmt.Printf("The service is installed but %s is not answering yet. Check %s and `aftertrace service status`.\n", ui, spec.LogPath())
	}
	fmt.Printf("Logs: %s\n", spec.LogPath())
	if plan.Manager == "systemd" {
		lingerHint()
	}
	return 0
}

func serviceUninstall(args []string) int {
	fs := flag.NewFlagSet("service uninstall", flag.ExitOnError)
	dry := fs.Bool("dry-run", false, "print the commands and file without running or removing anything")
	_ = fs.Parse(args)
	if fs.NArg() > 0 {
		fmt.Fprintln(os.Stderr, serviceUsage)
		return 2
	}
	plan, spec, err := servicePlan(nil)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	_, statErr := os.Stat(plan.Path)
	loaded := serviceRunning(plan) != ""
	if errors.Is(statErr, os.ErrNotExist) && !loaded {
		fmt.Printf("Not installed: %s does not exist.\n", plan.Path)
		return 0
	}
	run, remove := "Running", "Removing"
	if *dry {
		run, remove = "Would run", "Would remove"
	}
	fmt.Printf("%s:\n", run)
	for _, c := range plan.Uninstall {
		fmt.Println("  " + strings.Join(c, " "))
	}
	fmt.Printf("%s %s\n", remove, plan.Path)
	if *dry {
		return 0
	}
	fmt.Println()
	if loaded {
		_ = runCmd(plan.Uninstall[0])
	}
	if err := os.Remove(plan.Path); err != nil && !errors.Is(err, os.ErrNotExist) {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	for _, c := range plan.Uninstall[1:] {
		_ = runCmd(c)
	}
	fmt.Printf("Uninstalled. The database and %s are left as they are.\n", spec.LogPath())
	return 0
}

func serviceStatus(args []string) int {
	if len(args) > 0 {
		fmt.Fprintln(os.Stderr, serviceUsage)
		return 2
	}
	plan, spec, err := servicePlan(nil)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	b, err := os.ReadFile(plan.Path)
	if err != nil {
		fmt.Printf("Not installed (no %s).\nRun `aftertrace service install` to keep Aftertrace running at login.\n", plan.Path)
		return 3
	}
	state := serviceRunning(plan)
	if state == "" {
		state = "not loaded"
	}
	fmt.Printf("service   %s  %s\n", plan.Manager, plan.Path)
	fmt.Printf("command   %s\n", strings.Join(service.Command(plan.Manager, string(b)), " "))
	fmt.Printf("state     %s\n", state)
	fmt.Printf("log       %s\n", spec.LogPath())
	if strings.HasPrefix(state, "running") {
		return 0
	}
	return 3
}

// serviceRunning describes the service's state: "running (pid N)", another
// state, or "" when the manager does not know it.
func serviceRunning(plan service.Plan) string {
	out, err := exec.Command(plan.Status[0], plan.Status[1:]...).Output()
	if err != nil {
		return ""
	}
	kv := map[string]string{}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if k, v, ok := strings.Cut(line, " = "); ok && plan.Manager == "launchd" {
			if _, seen := kv[k]; !seen { // nested blocks repeat keys; the top level comes first
				kv[k] = v
			}
		} else if k, v, ok := strings.Cut(line, "="); ok && plan.Manager == "systemd" {
			kv[k] = v
		}
	}
	if plan.Manager == "systemd" {
		if kv["LoadState"] != "loaded" {
			return ""
		}
		if kv["ActiveState"] == "active" && kv["MainPID"] != "0" {
			return "running (pid " + kv["MainPID"] + ")"
		}
		return kv["ActiveState"] + " (" + kv["SubState"] + ")"
	}
	if kv["state"] == "running" && kv["pid"] != "" {
		return "running (pid " + kv["pid"] + ")"
	}
	if code := kv["last exit code"]; code != "" {
		return kv["state"] + ", last exit code " + code
	}
	return kv["state"]
}

func portsFree(f serveFlags) error {
	for _, p := range []int{*f.grpcPort, *f.httpPort, *f.uiPort} {
		addr := net.JoinHostPort(*f.listen, strconv.Itoa(p))
		ln, err := net.Listen("tcp", addr)
		if err != nil {
			return fmt.Errorf("%s is in use. If that is an `aftertrace serve` you started by hand, stop it first (pkill -f 'aftertrace serve'): the service needs the ports and the database", addr)
		}
		ln.Close()
	}
	return nil
}

func runCmd(c []string) error {
	fmt.Println("$ " + strings.Join(c, " "))
	cmd := exec.Command(c[0], c[1:]...)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	return cmd.Run()
}

func waitDial(addr string, d time.Duration) bool {
	for end := time.Now().Add(d); time.Now().Before(end); time.Sleep(250 * time.Millisecond) {
		if c, err := net.DialTimeout("tcp", addr, time.Second); err == nil {
			c.Close()
			return true
		}
	}
	return false
}

// lingerHint says how to keep a systemd --user service running after logout.
func lingerHint() {
	u, err := user.Current()
	if err != nil {
		return
	}
	out, err := exec.Command("loginctl", "show-user", u.Username, "--property=Linger").Output()
	if err == nil && strings.TrimSpace(string(out)) == "Linger=yes" {
		return
	}
	fmt.Printf("systemd stops user services when you log out. To keep it running, run: loginctl enable-linger %s\n", u.Username)
}
