package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/RahulKraken/aftertrace/internal/redact"
)

const compactBatch = 100
const compactFlush = 800

// CompactContent strips prompt/response/tool payload keys from stored JSON
// (the leftover `--store-content` LaunchAgent wrote ~6.5 KB per span) and
// checkpoints the WAL. Identity keys stay dropped. Returns how many tables
// were rewritten. Updates run in small batches so a 700 MB file stays under
// DuckDB's 256 MB memory_limit.
func (s *Store) CompactContent() (int, error) {
	if s == nil || s.Unavailable() {
		return 0, ErrUnavailable
	}
	s.wmu.Lock()
	defer s.wmu.Unlock()
	where := contentWhere("attrs")
	var hit int
	_ = s.DB.QueryRow(`SELECT 1 FROM spans WHERE ` + where + ` LIMIT 1`).Scan(&hit)
	if hit == 0 {
		return 0, nil
	}
	if _, err := s.DB.Exec(`CHECKPOINT`); err != nil {
		return 0, err
	}
	if err := s.recycleLocked(); err != nil {
		return 0, err
	}
	patch := map[string]any{}
	for _, k := range redact.ContentKeys {
		patch[k] = nil
	}
	for _, k := range redact.IdentityKeys {
		patch[k] = nil
	}
	raw, err := json.Marshal(patch)
	if err != nil {
		return 0, err
	}
	expr := `json_merge_patch(coalesce(attrs, '{}'::JSON), '` + strings.ReplaceAll(string(raw), `'`, `''`) + `'::JSON)`
	n := 0
	for _, table := range []string{"spans", "events", "span_events", "metric_points"} {
		changed, err := s.compactTable(table, expr, where)
		if err != nil {
			return n, err
		}
		if changed {
			n++
		}
	}
	if _, err := s.DB.Exec(`CHECKPOINT`); err != nil {
		return n, err
	}
	return n, nil
}

func (s *Store) compactTable(table, expr, where string) (bool, error) {
	var lo, hi sql.NullInt64
	if err := s.DB.QueryRow(`SELECT min(rowid), max(rowid) FROM `+table).Scan(&lo, &hi); err != nil {
		return false, fmt.Errorf("compact %s: %w", table, err)
	}
	if !lo.Valid {
		return false, nil
	}
	changed := false
	sinceFlush := 0
	for id := lo.Int64; id <= hi.Int64; id += int64(compactBatch) {
		res, err := s.DB.Exec(
			`UPDATE `+table+` SET attrs = `+expr+` WHERE rowid >= ? AND rowid < ? AND (`+where+`)`,
			id, id+int64(compactBatch),
		)
		if err != nil {
			return changed, fmt.Errorf("compact %s: %w", table, err)
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			continue
		}
		changed = true
		sinceFlush += int(n)
		if sinceFlush < compactFlush {
			continue
		}
		if _, err := s.DB.Exec(`CHECKPOINT`); err != nil {
			return changed, err
		}
		if err := s.recycleLocked(); err != nil {
			return changed, err
		}
		sinceFlush = 0
	}
	return changed, nil
}

func contentWhere(col string) string {
	keys := append(append([]string{}, redact.ContentKeys...), redact.IdentityKeys...)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		safe := strings.ReplaceAll(k, `"`, `""`)
		parts = append(parts, `json_extract(`+col+`, '$."`+safe+`"') IS NOT NULL`)
	}
	return strings.Join(parts, " OR ")
}
