package store

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/RahulKraken/aftertrace/internal/redact"
)

// CompactContent strips prompt/response/tool payload keys from stored JSON
// (the leftover `--store-content` LaunchAgent wrote ~6.5 KB per span) and
// checkpoints the WAL. Identity keys stay dropped. Returns how many tables
// were rewritten.
func (s *Store) CompactContent() (int, error) {
	if s == nil || s.DB == nil {
		return 0, fmt.Errorf("store: nil")
	}
	s.wmu.Lock()
	defer s.wmu.Unlock()
	var hit int
	_ = s.DB.QueryRow(`SELECT 1 FROM spans WHERE json_extract(attrs, '$."prompt"') IS NOT NULL OR json_extract(attrs, '$."user_prompt"') IS NOT NULL LIMIT 1`).Scan(&hit)
	if hit == 0 {
		return 0, nil
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
	for _, q := range []string{
		`UPDATE spans SET attrs = ` + expr,
		`UPDATE events SET attrs = ` + expr,
		`UPDATE span_events SET attrs = ` + expr,
		`UPDATE metric_points SET attrs = ` + expr,
	} {
		if _, err := s.DB.Exec(q); err != nil {
			return n, err
		}
		n++
	}
	if _, err := s.DB.Exec(`CHECKPOINT`); err != nil {
		return n, err
	}
	return n, nil
}
