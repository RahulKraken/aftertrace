//go:build unix

package harness

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type Sample struct {
	At         time.Time
	CPUSeconds float64
	RSS        uint64
}

type FileSnap struct {
	Path   string    `json:"path"`
	Size   int64     `json:"size"`
	Mtime  time.Time `json:"mtime"`
	Hash   string    `json:"hash,omitempty"`
	Exists bool      `json:"exists"`
}

func CPUFromState(st *os.ProcessState) float64 {
	if st == nil {
		return 0
	}
	ru, ok := st.SysUsage().(*syscall.Rusage)
	if !ok || ru == nil {
		return 0
	}
	return float64(ru.Utime.Nano()+ru.Stime.Nano()) / 1e9
}

func CPUSeconds(pid int) (float64, error) {
	if pid <= 0 {
		return 0, fmt.Errorf("pid")
	}
	if runtime.GOOS == "linux" {
		b, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
		if err != nil {
			return 0, err
		}
		// comm can contain spaces inside parentheses.
		s := string(b)
		rparen := strings.LastIndex(s, ")")
		if rparen < 0 {
			return 0, fmt.Errorf("stat")
		}
		fields := strings.Fields(s[rparen+2:])
		if len(fields) < 13 {
			return 0, fmt.Errorf("stat fields")
		}
		utime, _ := strconv.ParseFloat(fields[11], 64) // field 14, 0-indexed from after comm is 11
		stime, _ := strconv.ParseFloat(fields[12], 64)
		clk := float64(clkTck())
		if clk <= 0 {
			clk = 100
		}
		return (utime + stime) / clk, nil
	}
	out, err := exec.Command("ps", "-o", "time=", "-p", strconv.Itoa(pid)).Output()
	if err != nil {
		return 0, err
	}
	return parsePSTime(strings.TrimSpace(string(out)))
}

func RSS(pid int) (uint64, error) {
	if pid <= 0 {
		return 0, fmt.Errorf("pid")
	}
	if runtime.GOOS == "linux" {
		b, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
		if err != nil {
			return 0, err
		}
		for _, line := range strings.Split(string(b), "\n") {
			if strings.HasPrefix(line, "VmRSS:") {
				var kb uint64
				fmt.Sscanf(strings.TrimSpace(line[6:]), "%d", &kb)
				return kb * 1024, nil
			}
		}
		return 0, fmt.Errorf("VmRSS")
	}
	out, err := exec.Command("ps", "-o", "rss=", "-p", strconv.Itoa(pid)).Output()
	if err != nil {
		return 0, err
	}
	kb, err := strconv.ParseUint(strings.TrimSpace(string(out)), 10, 64)
	if err != nil {
		return 0, err
	}
	return kb * 1024, nil
}

func parsePSTime(s string) (float64, error) {
	// [[dd-]hh:]mm:ss[.xx]
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, fmt.Errorf("empty time")
	}
	days := 0
	if i := strings.IndexByte(s, '-'); i >= 0 {
		fmt.Sscanf(s[:i], "%d", &days)
		s = s[i+1:]
	}
	parts := strings.Split(s, ":")
	var h, m int
	var sec float64
	switch len(parts) {
	case 3:
		fmt.Sscanf(parts[0], "%d", &h)
		fmt.Sscanf(parts[1], "%d", &m)
		fmt.Sscanf(parts[2], "%f", &sec)
	case 2:
		fmt.Sscanf(parts[0], "%d", &m)
		fmt.Sscanf(parts[1], "%f", &sec)
	default:
		fmt.Sscanf(s, "%f", &sec)
	}
	return float64(days*86400+h*3600+m*60) + sec, nil
}

func clkTck() int64 {
	out, err := exec.Command("getconf", "CLK_TCK").Output()
	if err != nil {
		return 100
	}
	v, err := strconv.ParseInt(strings.TrimSpace(string(out)), 10, 64)
	if err != nil || v <= 0 {
		return 100
	}
	return v
}

func snapFile(path string) FileSnap {
	fi, err := os.Stat(path)
	if err != nil {
		return FileSnap{Path: path}
	}
	return FileSnap{Path: path, Size: fi.Size(), Mtime: fi.ModTime(), Exists: true}
}

func snapHashed(path string) FileSnap {
	s := snapFile(path)
	if s.Exists {
		s.Hash = fileSHA256(path)
	}
	return s
}

func fileSHA256(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return ""
	}
	return hex.EncodeToString(h.Sum(nil))
}

func filesChanged(before, after []FileSnap) bool {
	if len(before) != len(after) {
		return true
	}
	for i := range before {
		if before[i].Size != after[i].Size || before[i].Hash != after[i].Hash || !mtimeEq(before[i], after[i]) {
			return true
		}
	}
	return false
}

func mtimeEq(a, b FileSnap) bool {
	if !a.Exists && !b.Exists {
		return true
	}
	return a.Exists == b.Exists && a.Mtime.Equal(b.Mtime)
}

func dbFiles(path string) []string {
	return []string{path, path + ".wal"}
}

type SpillHit struct {
	Path string
	When time.Time
}

func watchSpill(dbPath string, stop <-chan struct{}, every time.Duration) *spillWatch {
	w := &spillWatch{db: dbPath, hits: make([]SpillHit, 0)}
	go w.loop(stop, every)
	return w
}

type spillWatch struct {
	db   string
	hits []SpillHit
}

func (w *spillWatch) loop(stop <-chan struct{}, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	w.check()
	for {
		select {
		case <-stop:
			w.check()
			return
		case <-t.C:
			w.check()
		}
	}
}

func (w *spillWatch) check() {
	now := time.Now()
	for _, p := range spillCandidates(w.db) {
		fi, err := os.Stat(p)
		if err != nil {
			continue
		}
		if fi.IsDir() {
			_ = filepath.WalkDir(p, func(path string, d fs.DirEntry, err error) error {
				if err != nil || d.IsDir() {
					return nil
				}
				w.hits = append(w.hits, SpillHit{Path: path, When: now})
				return nil
			})
			w.hits = append(w.hits, SpillHit{Path: p, When: now})
			continue
		}
		w.hits = append(w.hits, SpillHit{Path: p, When: now})
	}
}

func spillCandidates(dbPath string) []string {
	dir := filepath.Dir(dbPath)
	base := filepath.Base(dbPath)
	out := []string{
		dbPath + ".tmp",
		filepath.Join(dir, base+".tmp"),
		filepath.Join(dir, ".tmp"),
	}
	if ents, err := os.ReadDir(os.TempDir()); err == nil {
		for _, e := range ents {
			n := e.Name()
			if strings.Contains(strings.ToLower(n), "duckdb") {
				out = append(out, filepath.Join(os.TempDir(), n))
			}
		}
	}
	return out
}

func (w *spillWatch) Hits() []SpillHit { return w.hits }
