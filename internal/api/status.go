package api

import (
	"database/sql"
	"net/http"
	"sync"
	"time"

	"github.com/RahulKraken/aftertrace/internal/history"
	"github.com/RahulKraken/aftertrace/internal/rules"
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

// findingsCache keeps rule results for a few seconds so the sidebar can poll
// /api/status without re-running every rule each time.
type findingsCache struct {
	mu  sync.Mutex
	at  time.Time
	db  *sql.DB
	out []rules.Finding
}

var cachedFindings = &findingsCache{}

func findingsFor(db *sql.DB) []rules.Finding {
	c := cachedFindings
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.db == db && time.Since(c.at) < 10*time.Second {
		return c.out
	}
	c.out, c.db, c.at = rules.RunAll(db), db, time.Now()
	return c.out
}

func (s *Server) getStatus(w http.ResponseWriter, r *http.Request) {
	c, _ := s.Store.Counts()
	db := s.db()
	now := time.Now().UnixNano()
	var running, sessions int
	_ = db.QueryRow(`SELECT count(*) FROM turn_roots WHERE in_progress AND end_ns > ?`, now-int64(5*time.Minute)).Scan(&running)
	_ = db.QueryRow(`SELECT count(DISTINCT session_id) FROM turn_roots`).Scan(&sessions)
	open := 0
	for _, f := range findingsFor(db) {
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
	s.json(w, map[string]any{
		"now":       now,
		"info":      s.Info,
		"ask":       ask,
		"counts":    c,
		"running":   running,
		"sessions":  sessions,
		"findings":  open,
		"apps":      apps,
		"sources":   len(srcs),
		"last_ns":   last,
		"live_otel": history.LiveOTel(db),
		"history":   history.Summarize(db, histDir),
	}, 200)
}
