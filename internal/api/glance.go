package api

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/RahulKraken/aftertrace/internal/history"
	"github.com/RahulKraken/aftertrace/internal/rules"
)

func (s *Server) getGlance(w http.ResponseWriter, r *http.Request) {
	v, err := s.cache.get("glance", s.buildGlance)
	if err != nil {
		s.err(w, err, 500)
		return
	}
	s.json(w, v, 200)
}

func (s *Server) buildGlance() (any, error) {
	db := s.db()
	now := time.Now().UnixNano()
	var running, findings int
	_ = db.QueryRow(`SELECT count(*) FROM trace_roots WHERE in_progress AND end_ns > ?`, now-int64(5*time.Minute)).Scan(&running)
	fs := s.cachedFindings()
	for _, f := range fs {
		if f.Severity != "error" {
			findings++
		}
	}
	hi := now
	var latest sql.NullInt64
	_ = db.QueryRow(`SELECT max(end_ns) FROM trace_roots`).Scan(&latest)
	if latest.Valid && latest.Int64 < now-7*day {
		hi = latest.Int64 + 1
	}
	lo := hi - 7*day
	var weekCost sql.NullFloat64
	_ = db.QueryRow(`SELECT sum(cost_usd) FROM trace_roots WHERE start_ns >= ? AND start_ns < ?`, lo, hi).Scan(&weekCost)
	start := time.Now().Local()
	todayLo := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, start.Location()).UnixNano()
	var todayCost sql.NullFloat64
	_ = db.QueryRow(`SELECT cost_usd FROM day_stats WHERE day_start_ns=?`, todayLo).Scan(&todayCost)
	if !todayCost.Valid {
		_ = db.QueryRow(`SELECT sum(cost_usd) FROM trace_roots WHERE start_ns >= ? AND start_ns < ?`, todayLo, todayLo+day).Scan(&todayCost)
	}

	lanes, err := liveLanes(db, now)
	if err != nil {
		return nil, err
	}
	sess, err := sessions(db)
	if err != nil {
		sess = []map[string]any{}
	}
	byID := map[string]map[string]any{}
	for _, row := range sess {
		if id, _ := row["session_id"].(string); id != "" {
			byID[id] = row
		}
	}
	joined := make([]map[string]any, 0, len(lanes))
	for _, l := range lanes {
		row := byID[l.SessionID]
		if row == nil {
			row = map[string]any{}
		}
		title := l.Title
		if title == nil {
			if t, ok := row["title"].(string); ok && t != "" {
				title = &t
			}
		}
		item := map[string]any{
			"session_id": l.SessionID,
			"trace_id":   l.TraceID,
			"title":      title,
			"doing":      l.Doing,
			"running":    true,
			"quiet":      l.Quiet,
			"source":     l.Source,
			"last_ns":    l.LastNS,
			"repo":       row["repo"],
			"entrypoint": row["entrypoint"],
			"tokens":     row["tokens"],
			"cost_usd":   row["cost_usd"],
			"models":     row["models"],
		}
		if item["cost_usd"] == nil {
			item["cost_usd"] = l.CostUSD
		}
		joined = append(joined, item)
	}

	var topText string
	var topID any
	monthAgo := time.Now().AddDate(0, -1, 0).UnixNano()
	if len(fs) > 0 {
		spend, days := observeSpend(db, monthAgo, now)
		sv := rules.HomeSurfaceFrom(fs, rules.HomeOpts{
			SinceNS: monthAgo, HistoryOnly: history.Only(db), ObservedSpend: spend, WindowDays: days,
		})
		if len(sv.Shown) > 0 {
			f := sv.Shown[0]
			if f.Action != "" {
				topText = f.Action
			} else {
				topText = f.Headline
			}
			topID = f.ID
		}
	}

	return map[string]any{
		"ok":             true,
		"ready":          true,
		"busy":           false,
		"findings":       findings,
		"running":        running,
		"week_cost":      weekCost.Float64,
		"today_cost":     todayCost.Float64,
		"estimated":      history.Only(db),
		"sessions":       joined,
		"top_finding":    topText,
		"top_finding_id": topID,
	}, nil
}
