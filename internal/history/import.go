package history

import (
	"database/sql"
	"fmt"
	"os"
	"time"

	"github.com/RahulKraken/aftertrace/internal/store"
)

// Result is what one import pass did. Re-running on the same tree is a no-op
// for files whose size and mtime have not changed, and never writes a session
// that already has live OTel rows.
type Result struct {
	Dir              string `json:"dir"`
	Files            int    `json:"files"`
	Sessions         int    `json:"sessions"`
	Turns            int    `json:"turns"`
	Requests         int    `json:"requests"`
	SkippedOTel      int    `json:"skipped_otel"`
	SkippedUnchanged int    `json:"skipped_unchanged"`
	Empty            int    `json:"empty"`
	Errors           int    `json:"errors"`
}

// Import reads Claude Code session JSONL from dir (a projects tree) into the
// store. Missing dir is not an error: a machine with no Claude Code history
// just yields a zero result.
func Import(st *store.Store, dir string) (Result, error) {
	res := Result{Dir: dir}
	if dir == "" {
		return res, nil
	}
	fi, err := os.Stat(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return res, nil
		}
		return res, err
	}
	if !fi.IsDir() {
		return res, fmt.Errorf("%s: not a directory", dir)
	}
	files, err := ListTranscripts(dir)
	if err != nil {
		return res, err
	}
	res.Files = len(files)
	if len(files) == 0 {
		return res, nil
	}

	bySession := map[string][]File{}
	var sessionIDs []string
	for _, f := range files {
		sid := f.SessionID
		if sid == "" {
			sid = f.Path
		}
		if _, ok := bySession[sid]; !ok {
			sessionIDs = append(sessionIDs, sid)
		}
		bySession[sid] = append(bySession[sid], f)
	}
	live, err := st.LiveSessions(sessionIDs)
	if err != nil {
		return res, err
	}
	known, err := loadFileRows(st.DB)
	if err != nil {
		return res, err
	}

	now := time.Now().UnixNano()
	for sid, group := range bySession {
		if live[sid] {
			res.SkippedOTel += len(group)
			for _, f := range group {
				_ = upsertFile(st.DB, f, "skipped_otel", 0, 0, now)
			}
			continue
		}
		if unchanged(group, known) {
			res.SkippedUnchanged += len(group)
			continue
		}
		var out sessionOut
		out.SessionID = sid
		nErr, nEmpty := 0, 0
		for _, f := range group {
			recs, err := ParseFile(f.Path)
			if err != nil {
				nErr++
				_ = upsertFile(st.DB, f, "error", 0, 0, now)
				continue
			}
			part := Convert(f.SessionID, recs, f.Subagent)
			if part.SessionID != "" {
				out.SessionID = part.SessionID
			}
			if live[out.SessionID] {
				res.SkippedOTel++
				_ = upsertFile(st.DB, f, "skipped_otel", 0, 0, now)
				continue
			}
			if len(part.Spans) == 0 && len(part.Events) == 0 {
				nEmpty++
				_ = upsertFile(st.DB, f, "empty", 0, 0, now)
				continue
			}
			out.Spans = append(out.Spans, part.Spans...)
			out.Events = append(out.Events, part.Events...)
			out.Turns += part.Turns
			out.Requests += part.Requests
			_ = upsertFile(st.DB, f, "imported", part.Turns, part.Requests, now)
		}
		res.Errors += nErr
		res.Empty += nEmpty
		if live[out.SessionID] {
			continue
		}
		if len(out.Spans) == 0 && len(out.Events) == 0 {
			continue
		}
		if err := st.ReplaceHistory(out.SessionID, out.Spans, nil, out.Events, nil); err != nil {
			return res, err
		}
		res.Sessions++
		res.Turns += out.Turns
		res.Requests += out.Requests
	}
	return res, nil
}

func unchanged(group []File, known map[string]fileRow) bool {
	if len(group) == 0 {
		return true
	}
	for _, f := range group {
		prev, ok := known[f.Path]
		if !ok || prev.size != f.Size || prev.mtime != f.MtimeNS || prev.status != "imported" {
			return false
		}
	}
	return true
}

type fileRow struct {
	size   int64
	mtime  int64
	status string
}

func loadFileRows(db *sql.DB) (map[string]fileRow, error) {
	rows, err := db.Query(`SELECT path, size, mtime_ns, status FROM history_files`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]fileRow{}
	for rows.Next() {
		var path, status string
		var size, mtime int64
		if err := rows.Scan(&path, &size, &mtime, &status); err != nil {
			return nil, err
		}
		out[path] = fileRow{size: size, mtime: mtime, status: status}
	}
	return out, rows.Err()
}

func upsertFile(db *sql.DB, f File, status string, turns, requests int, now int64) error {
	_, err := db.Exec(`INSERT OR REPLACE INTO history_files
		(path, size, mtime_ns, session_id, status, turns, requests, imported_at_ns)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		f.Path, f.Size, f.MtimeNS, nullStr(f.SessionID), status, turns, requests, now)
	return err
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
