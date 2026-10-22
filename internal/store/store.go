package store

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"github.com/RahulKraken/aftertrace/internal/pricing"
	"os"
	"path/filepath"
	"sync"

	_ "github.com/duckdb/duckdb-go/v2"
)

//go:embed schema.sql
var schemaSQL string

//go:embed views.sql
var viewsSQL string

// Store is a DuckDB file plus the Aftertrace schema. One writer; callers serialize with Mu.
type Store struct {
	DB   *sql.DB
	Path string
	Mu   sync.Mutex
}

type Span struct {
	TraceID       string
	SpanID        string
	ParentSpanID  string
	Name          string
	StartNS       int64
	EndNS         int64
	DurationMS    float64
	IsError       bool
	StatusMessage string
	SessionID     string
	Attrs         map[string]any
	Resource      map[string]any
}

type SpanEvent struct {
	TraceID string
	SpanID  string
	Name    string
	TimeNS  int64
	Attrs   map[string]any
}

type Event struct {
	TsNS      int64
	Name      string
	SessionID string
	PromptID  string
	TraceID   string
	SpanID    string
	RequestID string
	ToolUseID string
	Attrs     map[string]any
	Resource  map[string]any
}

type MetricPoint struct {
	Name      string
	Unit      string
	TsNS      int64
	Value     float64
	SessionID string
	Attrs     map[string]any
	Resource  map[string]any
}

type Counts struct {
	Spans        int
	SpanEvents   int
	Events       int
	MetricPoints int
}

// dsnOptions apply to the whole DuckDB instance, so they also cover user SQL from /api/sql.
// No file, network, or extension access, and no SET to undo it. Nothing in Aftertrace reads
// files through DuckDB; ingest goes through Go. A second read-only instance is not an
// option: DuckDB refuses a different configuration on a file this process already holds.
const dsnOptions = "?enable_external_access=false&lock_configuration=true"

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("duckdb", path+dsnOptions)
	if err != nil {
		return nil, err
	}
	s := &Store{DB: db, Path: path}
	if _, err := db.Exec(schemaSQL); err != nil {
		db.Close()
		return nil, fmt.Errorf("schema: %w", err)
	}
	if err := pricing.Seed(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("prices: %w", err)
	}
	if _, err := db.Exec(viewsSQL); err != nil {
		db.Close()
		return nil, fmt.Errorf("views: %w", err)
	}
	return s, nil
}

func (s *Store) Close() error {
	if s == nil || s.DB == nil {
		return nil
	}
	return s.DB.Close()
}

func (s *Store) Insert(spans []Span, sevs []SpanEvent, evs []Event, pts []MetricPoint) error {
	s.Mu.Lock()
	defer s.Mu.Unlock()
	return s.insertLocked(spans, sevs, evs, pts)
}

func (s *Store) insertLocked(spans []Span, sevs []SpanEvent, evs []Event, pts []MetricPoint) error {
	ctx := context.Background()
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if len(spans) > 0 {
		stmt, err := tx.PrepareContext(ctx, `INSERT OR REPLACE INTO spans
			(trace_id, span_id, parent_span_id, name, start_ns, end_ns, duration_ms, is_error, status_message, session_id, attrs, resource)
			VALUES (?,?,?,?,?,?,?,?,?,?,?::JSON,?::JSON)`)
		if err != nil {
			return err
		}
		for _, sp := range spans {
			parent := nullEmpty(sp.ParentSpanID)
			if _, err := stmt.ExecContext(ctx, sp.TraceID, sp.SpanID, parent, sp.Name, sp.StartNS, sp.EndNS,
				sp.DurationMS, sp.IsError, nullEmpty(sp.StatusMessage), nullEmpty(sp.SessionID),
				asJSON(sp.Attrs), asJSON(sp.Resource)); err != nil {
				stmt.Close()
				return fmt.Errorf("span %s/%s: %w", sp.TraceID, sp.SpanID, err)
			}
		}
		stmt.Close()
	}
	if len(sevs) > 0 {
		stmt, err := tx.PrepareContext(ctx, `INSERT OR REPLACE INTO span_events
			(trace_id, span_id, name, time_ns, attrs) VALUES (?,?,?,?,?::JSON)`)
		if err != nil {
			return err
		}
		for _, e := range sevs {
			if _, err := stmt.ExecContext(ctx, e.TraceID, e.SpanID, e.Name, e.TimeNS, asJSON(e.Attrs)); err != nil {
				stmt.Close()
				return err
			}
		}
		stmt.Close()
	}
	if len(evs) > 0 {
		stmt, err := tx.PrepareContext(ctx, `INSERT INTO events
			(ts_ns, name, session_id, prompt_id, trace_id, span_id, request_id, tool_use_id, attrs, resource)
			VALUES (?,?,?,?,?,?,?,?,?::JSON,?::JSON)`)
		if err != nil {
			return err
		}
		for _, e := range evs {
			if _, err := stmt.ExecContext(ctx, e.TsNS, e.Name, nullEmpty(e.SessionID), nullEmpty(e.PromptID),
				nullEmpty(e.TraceID), nullEmpty(e.SpanID), nullEmpty(e.RequestID), nullEmpty(e.ToolUseID),
				asJSON(e.Attrs), asJSON(e.Resource)); err != nil {
				stmt.Close()
				return err
			}
		}
		stmt.Close()
	}
	if len(pts) > 0 {
		stmt, err := tx.PrepareContext(ctx, `INSERT INTO metric_points
			(name, unit, ts_ns, value, session_id, attrs, resource)
			VALUES (?,?,?,?,?,?::JSON,?::JSON)`)
		if err != nil {
			return err
		}
		for _, p := range pts {
			if _, err := stmt.ExecContext(ctx, p.Name, p.Unit, p.TsNS, p.Value, nullEmpty(p.SessionID),
				asJSON(p.Attrs), asJSON(p.Resource)); err != nil {
				stmt.Close()
				return err
			}
		}
		stmt.Close()
	}
	return tx.Commit()
}

func (s *Store) Counts() (Counts, error) {
	s.Mu.Lock()
	defer s.Mu.Unlock()
	var c Counts
	row := s.DB.QueryRow(`SELECT
		(SELECT count(*) FROM spans),
		(SELECT count(*) FROM span_events),
		(SELECT count(*) FROM events),
		(SELECT count(*) FROM metric_points)`)
	err := row.Scan(&c.Spans, &c.SpanEvents, &c.Events, &c.MetricPoints)
	return c, err
}

func asJSON(m map[string]any) string {
	if m == nil {
		return `{}`
	}
	b, err := json.Marshal(m)
	if err != nil {
		return `{}`
	}
	return string(b)
}

func nullEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
