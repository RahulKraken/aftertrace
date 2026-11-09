package api

import (
	"database/sql"
	"net/http"
	"sync"
	"time"

	"github.com/RahulKraken/aftertrace/internal/history"
	"github.com/RahulKraken/aftertrace/internal/rules"
	"github.com/RahulKraken/aftertrace/internal/store"
)

// Info is what the server knows about itself, shown in Settings and Connect.
type Info struct {
	Version      string `json:"version"`
	DBPath       string `json:"db_path"`
	StoreContent bool   `json:"store_content"`
	GRPC         string `json:"otlp_grpc"`
	HTTP         string `json:"otlp_http"`
	UI           string `json:"ui"`
	// Service is "launchd" or "systemd" when started by aftertrace service install.
	Service string `json:"service"`
	// HistoryDir is the Claude Code projects tree serve imported on start.
	HistoryDir string `json:"history_dir,omitempty"`
}

func WithInfo(i Info) Option { return func(s *Server) { s.Info = i } }

type findingsInflight struct {
	wg  sync.WaitGroup
	out []rules.Finding
}

// findingsCache keeps rule results so polled endpoints never wait on RunAll
// after the first computation. A stale copy is served while a refresh runs.
type findingsCache struct {
	mu     sync.Mutex
	at     time.Time
	db     *sql.DB
	out    []rules.Finding
	loaded bool
	inf    *findingsInflight
	st     *store.Store
}

var cachedFindings = &findingsCache{}

func findingsFor(db *sql.DB) []rules.Finding {
	c := cachedFindings
	c.mu.Lock()
	if c.db == db && c.loaded && time.Since(c.at) < 30*time.Second {
		out := c.out
		c.mu.Unlock()
		return out
	}
	if c.db == db && c.loaded {
		out := c.out
		if c.inf == nil {
			c.inf = startFindingsRefresh(db)
		}
		c.mu.Unlock()
		return out
	}
	if inf := c.inf; inf != nil {
		c.mu.Unlock()
		inf.wg.Wait()
		return findingsFor(db)
	}
	inf := startFindingsRefresh(db)
	c.inf = inf
	c.mu.Unlock()
	inf.wg.Wait()
	return inf.out
}

func startFindingsRefresh(db *sql.DB) *findingsInflight {
	inf := &findingsInflight{}
	inf.wg.Add(1)
	go func() {
		out := rules.RunAll(db)
		if out == nil {
			out = []rules.Finding{}
		}
		applySessionFindingCounts(out)
		inf.out = out
		c := cachedFindings
		c.mu.Lock()
		c.out, c.db, c.at, c.loaded, c.inf = out, db, time.Now(), true, nil
		c.mu.Unlock()
		inf.wg.Done()
	}()
	return inf
}

func applySessionFindingCounts(fs []rules.Finding) {
	cachedFindings.mu.Lock()
	st := cachedFindings.st
	cachedFindings.mu.Unlock()
	if st == nil {
		return
	}
	counts := map[string]int{}
	for _, f := range fs {
		for _, sid := range f.Sessions {
			counts[sid]++
		}
	}
	_ = st.SetSessionFindings(counts)
}

func (s *Server) getStatus(w http.ResponseWriter, r *http.Request) {
	v, err := s.cache.get("status", s.buildStatus)
	if err != nil {
		s.err(w, err, 500)
		return
	}
	s.json(w, v, 200)
}

func (s *Server) buildStatus() (any, error) {
	c, ok := s.Store.CachedCounts()
	if !ok {
		c, _ = s.Store.Counts()
	}
	db := s.db()
	now := time.Now().UnixNano()
	var running, sessions int
	_ = db.QueryRow(`SELECT count(*) FROM trace_roots WHERE in_progress AND end_ns > ?`, now-int64(5*time.Minute)).Scan(&running)
	_ = db.QueryRow(`SELECT count(*) FROM session_stats`).Scan(&sessions)
	fs := s.cachedFindings()
	open := 0
	for _, f := range fs {
		if f.Severity != "error" {
			open++
		}
	}
	srcs, _ := sources(db, now)
	apps := 0
	var last int64
	for _, src := range srcs {
		if src.Kind == "app" {
			apps++
		}
		if src.LastNS > last {
			last = src.LastNS
		}
	}
	ask := map[string]any{"enabled": s.Ask != nil}
	if s.Ask != nil {
		ask["model"] = s.Ask.Model
	}
	histDir := s.Info.HistoryDir
	if histDir == "" {
		histDir = history.DefaultDir()
	}
	monthAgo := time.Now().AddDate(0, -1, 0).UnixNano()
	welcome := rules.PickMoneyFinding(fs, monthAgo, true)
	return map[string]any{
		"now":             now,
		"info":            s.Info,
		"ask":             ask,
		"counts":          c,
		"running":         running,
		"sessions":        sessions,
		"findings":        open,
		"apps":            apps,
		"sources":         len(srcs),
		"last_ns":         last,
		"live_otel":       history.LiveOTel(db),
		"history":         history.Summarize(db, histDir),
		"welcome_finding": welcome,
	}, nil
}

func (s *Server) cachedFindings() []rules.Finding {
	if s.Store != nil {
		cachedFindings.mu.Lock()
		cachedFindings.st = s.Store
		cachedFindings.mu.Unlock()
	}
	return findingsFor(s.db())
}
