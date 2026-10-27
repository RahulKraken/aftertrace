package store

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/RahulKraken/aftertrace/internal/pricing"

	_ "github.com/duckdb/duckdb-go/v2"
)

//go:embed schema.sql
var schemaSQL string

//go:embed views.sql
var viewsSQL string

// Store is a DuckDB file plus the Aftertrace schema. Reads need no lock: every
// pooled connection is a connection to one DuckDB instance, and DuckDB's MVCC
// gives each query a snapshot, so a slow read never waits on ingest or other
// reads. Writes go through Insert, which takes wmu: two batches that INSERT OR
// REPLACE the same span would otherwise fail with a transaction conflict.
type Store struct {
	DB   *sql.DB
	Path string
	wmu  sync.Mutex
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

// HistorySource is the resource attribute aftertrace.source on rows imported
// from Claude Code session transcripts, so they can be told apart from OTel.
const HistorySource = "history"

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
	s.wmu.Lock()
	defer s.wmu.Unlock()
	if live := liveSessionIDs(spans, evs, pts); len(live) > 0 {
		if err := s.dropHistoryLocked(live); err != nil {
			return err
		}
	}
	return s.insertLocked(spans, sevs, evs, pts)
}

// ReplaceHistory deletes previously imported history rows for one session
// and writes the new batch in the same lock, so a re-import is idempotent
// even for events and metric points, which have no primary key.
func (s *Store) ReplaceHistory(sessionID string, spans []Span, sevs []SpanEvent, evs []Event, pts []MetricPoint) error {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	if err := s.dropHistoryLocked([]string{sessionID}); err != nil {
		return err
	}
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

func isHistory(res map[string]any) bool {
	if res == nil {
		return false
	}
	v, _ := res["aftertrace.source"].(string)
	return v == HistorySource
}

func liveSessionIDs(spans []Span, evs []Event, pts []MetricPoint) []string {
	seen := map[string]struct{}{}
	add := func(id string, hist bool) {
		if id == "" || hist {
			return
		}
		seen[id] = struct{}{}
	}
	for _, sp := range spans {
		add(sp.SessionID, isHistory(sp.Resource))
	}
	for _, e := range evs {
		add(e.SessionID, isHistory(e.Resource))
	}
	for _, p := range pts {
		add(p.SessionID, isHistory(p.Resource))
	}
	out := make([]string, 0, len(seen))
	for id := range seen {
		out = append(out, id)
	}
	return out
}

const historyPred = `coalesce(json_extract_string(resource, '$."aftertrace.source"'), '') = 'history'`

func (s *Store) dropHistoryLocked(ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	ph := placeholders(len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	var one int
	err := s.DB.QueryRow(`SELECT 1 FROM spans WHERE session_id IN (`+ph+`) AND `+historyPred+` LIMIT 1`, args...).Scan(&one)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if _, err := s.DB.Exec(`DELETE FROM span_events WHERE trace_id IN (
		SELECT DISTINCT trace_id FROM spans WHERE session_id IN (`+ph+`) AND `+historyPred+`)`, args...); err != nil {
		return fmt.Errorf("drop history span_events: %w", err)
	}
	if _, err := s.DB.Exec(`DELETE FROM spans WHERE session_id IN (`+ph+`) AND `+historyPred, args...); err != nil {
		return fmt.Errorf("drop history spans: %w", err)
	}
	if _, err := s.DB.Exec(`DELETE FROM events WHERE session_id IN (`+ph+`) AND `+historyPred, args...); err != nil {
		return fmt.Errorf("drop history events: %w", err)
	}
	if _, err := s.DB.Exec(`DELETE FROM metric_points WHERE session_id IN (`+ph+`) AND `+historyPred, args...); err != nil {
		return fmt.Errorf("drop history metrics: %w", err)
	}
	if _, err := s.DB.Exec(`UPDATE history_files SET status = 'skipped_otel' WHERE session_id IN (`+ph+`) AND status = 'imported'`, args...); err != nil {
		return fmt.Errorf("history_files: %w", err)
	}
	return nil
}

// LiveSessions reports which of the given session ids already have OTel rows
// (aftertrace.source is not history). Those sessions are owned by the live feed.
func (s *Store) LiveSessions(ids []string) (map[string]bool, error) {
	out := map[string]bool{}
	if len(ids) == 0 {
		return out, nil
	}
	ph := placeholders(len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	rows, err := s.DB.Query(`SELECT DISTINCT session_id FROM spans
		WHERE session_id IN (`+ph+`) AND coalesce(json_extract_string(resource, '$."aftertrace.source"'), '') <> 'history'`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

func placeholders(n int) string {
	if n <= 0 {
		return ""
	}
	return strings.Repeat("?,", n-1) + "?"
}
