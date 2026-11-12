//go:build unix

package harness

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
)

// Proc is a real `aftertrace serve` child the harness drives.
type Proc struct {
	Cmd      *exec.Cmd
	Bin      string
	DB       string
	History  string
	UI       string
	GRPC     string
	HTTPOTLP string
	LogPath  string
	log      *os.File
	env      []string
	http     *http.Client
}

var harnessHTTP = &http.Client{Timeout: 15 * time.Second}

type StartOpts struct {
	Bin           string
	Dir           string
	HistoryDir    string
	DB            string
	NoHistory     bool
	ExitAfterWarm bool
	ExtraEnv      []string
	FailStore     string // path for AFTERTRACE_FAIL_STORE
}

func Start(opts StartOpts) (*Proc, error) {
	if opts.Bin == "" {
		return nil, fmt.Errorf("binary path required")
	}
	if opts.Dir == "" {
		return nil, fmt.Errorf("dir required")
	}
	if err := os.MkdirAll(opts.Dir, 0o755); err != nil {
		return nil, err
	}
	if opts.DB == "" {
		opts.DB = filepath.Join(opts.Dir, "aftertrace.duckdb")
	}
	uiPort, err := freePort()
	if err != nil {
		return nil, err
	}
	grpcPort, err := freePort()
	if err != nil {
		return nil, err
	}
	httpPort, err := freePort()
	if err != nil {
		return nil, err
	}
	args := []string{
		"serve",
		"--db", opts.DB,
		"--listen", "127.0.0.1",
		"--ui-port", fmt.Sprintf("%d", uiPort),
		"--grpc-port", fmt.Sprintf("%d", grpcPort),
		"--http-port", fmt.Sprintf("%d", httpPort),
	}
	if opts.NoHistory {
		args = append(args, "--no-history")
	} else if opts.HistoryDir != "" {
		args = append(args, "--history-dir", opts.HistoryDir)
	}
	if opts.ExitAfterWarm {
		args = append(args, "--exit-after-warm")
	}
	logPath := filepath.Join(opts.Dir, "serve.log")
	logF, err := os.Create(logPath)
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(opts.Bin, args...)
	cmd.Stdout = logF
	cmd.Stderr = logF
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	env := append(os.Environ(), opts.ExtraEnv...)
	if opts.FailStore != "" {
		env = append(env, "AFTERTRACE_FAIL_STORE="+opts.FailStore)
	}
	cmd.Env = env
	if err := cmd.Start(); err != nil {
		logF.Close()
		return nil, err
	}
	p := &Proc{
		Cmd:      cmd,
		Bin:      opts.Bin,
		DB:       opts.DB,
		History:  opts.HistoryDir,
		UI:       fmt.Sprintf("127.0.0.1:%d", uiPort),
		GRPC:     fmt.Sprintf("127.0.0.1:%d", grpcPort),
		HTTPOTLP: fmt.Sprintf("127.0.0.1:%d", httpPort),
		LogPath:  logPath,
		log:      logF,
		env:      env,
		http:     harnessHTTP,
	}
	return p, nil
}

func (p *Proc) PID() int {
	if p == nil || p.Cmd == nil || p.Cmd.Process == nil {
		return 0
	}
	return p.Cmd.Process.Pid
}

func (p *Proc) WaitReady(d time.Duration) error {
	deadline := time.Now().Add(d)
	url := "http://" + p.UI + "/api/health"
	var last error
	for time.Now().Before(deadline) {
		if p.Cmd.Process != nil {
			if err := p.Cmd.Process.Signal(syscall.Signal(0)); err != nil {
				return fmt.Errorf("serve exited before ready: %s", p.tailLog())
			}
		}
		res, err := p.http.Get(url)
		if err == nil {
			res.Body.Close()
			if res.StatusCode == 200 {
				return nil
			}
			last = fmt.Errorf("health %d", res.StatusCode)
		} else {
			last = err
		}
		time.Sleep(50 * time.Millisecond)
	}
	if last == nil {
		last = fmt.Errorf("timeout")
	}
	return fmt.Errorf("ready: %w\n%s", last, p.tailLog())
}

func (p *Proc) WaitExit(d time.Duration) error {
	done := make(chan error, 1)
	go func() { done <- p.Cmd.Wait() }()
	select {
	case err := <-done:
		return err
	case <-time.After(d):
		_ = p.Kill()
		return fmt.Errorf("serve did not exit within %s", d)
	}
}

func (p *Proc) Stop() error {
	if p == nil || p.Cmd == nil || p.Cmd.Process == nil {
		return nil
	}
	if p.Cmd.ProcessState != nil && p.Cmd.ProcessState.Exited() {
		if p.log != nil {
			p.log.Close()
			p.log = nil
		}
		return nil
	}
	_ = p.Cmd.Process.Signal(syscall.SIGTERM)
	done := make(chan error, 1)
	go func() { done <- p.Cmd.Wait() }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		_ = p.Kill()
		<-done
	}
	if p.log != nil {
		p.log.Close()
		p.log = nil
	}
	return nil
}

func (p *Proc) Kill() error {
	if p == nil || p.Cmd == nil || p.Cmd.Process == nil {
		return nil
	}
	pid := p.Cmd.Process.Pid
	_ = syscall.Kill(-pid, syscall.SIGKILL)
	_ = p.Cmd.Process.Kill()
	_, _ = p.Cmd.Process.Wait()
	if p.log != nil {
		p.log.Close()
		p.log = nil
	}
	return nil
}

func (p *Proc) tailLog() string {
	b, err := os.ReadFile(p.LogPath)
	if err != nil {
		return err.Error()
	}
	if len(b) > 4000 {
		b = b[len(b)-4000:]
	}
	return string(b)
}

func (p *Proc) GET(path string) (status int, body []byte, d time.Duration, err error) {
	t0 := time.Now()
	res, err := p.http.Get("http://" + p.UI + path)
	d = time.Since(t0)
	if err != nil {
		return 0, nil, d, err
	}
	defer res.Body.Close()
	body, _ = io.ReadAll(res.Body)
	return res.StatusCode, body, d, nil
}

func (p *Proc) SQL(q string) ([]byte, error) {
	payload := fmt.Sprintf(`{"sql":%q}`, q)
	res, err := p.http.Post("http://"+p.UI+"/api/sql", "application/json", strings.NewReader(payload))
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	if res.StatusCode != 200 {
		return b, fmt.Errorf("sql %d: %s", res.StatusCode, trim(b, 300))
	}
	return b, nil
}

func (p *Proc) JSON(path string, v any) error {
	st, body, _, err := p.GET(path)
	if err != nil {
		return err
	}
	if st != 200 {
		return fmt.Errorf("%s -> %d %s", path, st, trim(body, 200))
	}
	return json.Unmarshal(body, v)
}

func freePort() (int, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port, nil
}

func BuildBin(outDir string) (string, error) {
	if p := os.Getenv("AFTERTRACE_BIN"); p != "" {
		return p, nil
	}
	root, err := findModRoot()
	if err != nil {
		return "", err
	}
	bin := filepath.Join(outDir, "aftertrace")
	if runtime.GOOS == "windows" {
		bin += ".exe"
	}
	cmd := exec.Command("go", "build", "-o", bin, "./cmd/aftertrace")
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "CGO_ENABLED=1")
	b, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("go build: %w\n%s", err, b)
	}
	return bin, nil
}

func trim(b []byte, n int) string {
	s := string(b)
	if len(s) > n {
		return s[:n]
	}
	return s
}

// ScanLogLines is a helper for tests that want to watch serve output.
func ScanLogLines(path string, fn func(string) bool) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if fn(sc.Text()) {
			return true
		}
	}
	return false
}
