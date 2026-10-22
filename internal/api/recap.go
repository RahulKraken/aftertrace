package api

import (
	"database/sql"
	"net/http"
	"sort"
	"strconv"
	"time"
)

// GET /api/recap?week=N: the Nth week back (0 = the 7 days ending now, or at
// the newest data). Everything the Recap page and its shareable receipt show.
func (s *Server) getRecap(w http.ResponseWriter, r *http.Request) {
	back, _ := strconv.Atoi(r.URL.Query().Get("week"))
	if back < 0 || back > 52 {
		back = 0
	}
	db := s.db()
	now := time.Now().UnixNano()
	stats, err := traceStats(db)
	if err != nil {
		s.err(w, err, 500)
		return
	}
	hi := now
	var latest, earliest sql.NullInt64
	_ = db.QueryRow(`SELECT max(end_ns), min(start_ns) FROM turn_roots`).Scan(&latest, &earliest)
	if latest.Valid && latest.Int64 < now-7*day {
		hi = latest.Int64 + 1
	}
	hi -= int64(back) * 7 * day
	lo := hi - 7*day
	cur, turns, err := summarize(db, stats, lo, hi)
	if err != nil {
		s.err(w, err, 500)
		return
	}
	prev, _, err := summarize(db, stats, lo-7*day, lo)
	if err != nil {
		s.err(w, err, 500)
		return
	}

	out := map[string]any{
		"week":      back,
		"lo":        lo,
		"hi":        hi,
		"has_older": earliest.Valid && earliest.Int64 < lo,
		"stats":     cur,
		"prev":      prev,
	}
	out["tools"] = topRows(db, `SELECT coalesce(tool_name, '?'), count(*), coalesce(sum(exec_ms), 0), coalesce(sum(wait_ms), 0)
		FROM tools WHERE start_ns >= ? AND start_ns < ? GROUP BY 1 ORDER BY 2 DESC LIMIT 6`, lo, hi, "tool", "calls", "exec_ms", "wait_ms")
	out["models"] = topRows(db, `SELECT coalesce(model, '?'), count(*), coalesce(sum(cost_usd), 0), coalesce(sum(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens), 0)
		FROM llm WHERE start_ns >= ? AND start_ns < ? GROUP BY 1 ORDER BY 3 DESC LIMIT 5`, lo, hi, "model", "requests", "cost_usd", "tokens")
	out["apps"] = topRows(db, `SELECT service, count(*), coalesce(sum(cost_usd), 0), count(*) FILTER (WHERE is_error OR error_type IS NOT NULL)
		FROM calls WHERE start_ns >= ? AND start_ns < ? GROUP BY 1 ORDER BY 3 DESC LIMIT 5`, lo, hi, "service", "calls", "cost_usd", "failed")

	// Priciest and longest turns, with their prompts when captured.
	type turnCost struct {
		trace, session string
		start          int64
		dur, cost      float64
	}
	var tc []turnCost
	for _, t := range turns {
		var c sql.NullFloat64
		_ = db.QueryRow(`SELECT sum(cost_usd) FROM llm WHERE trace_id=?`, t.trace).Scan(&c)
		tc = append(tc, turnCost{t.trace, t.session, t.start, t.durMS, c.Float64})
	}
	pick := func(less func(a, b turnCost) bool) any {
		if len(tc) == 0 {
			return nil
		}
		best := tc[0]
		for _, x := range tc[1:] {
			if less(best, x) {
				best = x
			}
		}
		m := map[string]any{"trace_id": best.trace, "session_id": best.session, "start_ns": best.start, "duration_ms": best.dur, "cost_usd": best.cost}
		if p, err := turnPrompt(db, best.trace); err == nil && p.Valid {
			m["prompt"] = clipLabel(p.String)
		}
		return m
	}
	out["priciest"] = pick(func(a, b turnCost) bool { return b.cost > a.cost })
	out["longest"] = pick(func(a, b turnCost) bool { return b.dur > a.dur })

	// Busiest local day by agent time, and peak parallel turns over the week.
	byDay := map[string]float64{}
	for _, t := range turns {
		byDay[time.Unix(0, t.start).Local().Format("2006-01-02")] += t.durMS
	}
	var busiest string
	for d, v := range byDay {
		if busiest == "" || v > byDay[busiest] {
			busiest = d
		}
	}
	out["busiest_day"] = nil
	if busiest != "" {
		out["busiest_day"] = map[string]any{"day": busiest, "turn_ms": byDay[busiest], "lanes": dayLanes(db, turns, busiest)}
	}
	out["peak_parallel"] = peakParallel(turns)
	s.json(w, out, 200)
}

// topRows runs a 4-column grouping query and names the columns.
func topRows(db *sql.DB, q string, lo, hi int64, k0, k1, k2, k3 string) []map[string]any {
	out := []map[string]any{}
	rows, err := db.Query(q, lo, hi)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var a string
		var b int64
		var c, d float64
		if rows.Scan(&a, &b, &c, &d) == nil {
			out = append(out, map[string]any{k0: a, k1: b, k2: c, k3: d})
		}
	}
	return out
}

// dayLanes is one lane per session on a given local day, each with its
// turns as [start, end] pairs: the "day in lanes" timeline.
func dayLanes(db *sql.DB, turns []turnRow, day string) []map[string]any {
	type lane struct {
		session string
		spans   [][2]int64
		first   int64
	}
	lanes := map[string]*lane{}
	for _, t := range turns {
		if time.Unix(0, t.start).Local().Format("2006-01-02") != day {
			continue
		}
		key := t.session
		if key == "" {
			key = t.trace
		}
		l := lanes[key]
		if l == nil {
			l = &lane{session: t.session, first: t.start}
			lanes[key] = l
		}
		l.spans = append(l.spans, [2]int64{t.start, t.end})
	}
	list := make([]*lane, 0, len(lanes))
	for _, l := range lanes {
		list = append(list, l)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].first < list[j].first })
	out := []map[string]any{}
	for _, l := range list {
		var title any
		var t sql.NullString
		if err := db.QueryRow(`SELECT a(attrs,'prompt') FROM events WHERE name='user_prompt' AND session_id=? AND `+notRedacted("a(attrs,'prompt')")+`
			ORDER BY ts_ns LIMIT 1`, l.session).Scan(&t); err == nil && t.Valid {
			title = clipLabel(t.String)
		}
		out = append(out, map[string]any{"session_id": l.session, "title": title, "turns": l.spans})
	}
	return out
}

func peakParallel(turns []turnRow) int {
	type ev struct {
		t int64
		d int
	}
	var evs []ev
	for _, t := range turns {
		evs = append(evs, ev{t.start, 1}, ev{t.end, -1})
	}
	sort.Slice(evs, func(i, j int) bool {
		if evs[i].t == evs[j].t {
			return evs[i].d < evs[j].d
		}
		return evs[i].t < evs[j].t
	})
	cur, peak := 0, 0
	for _, e := range evs {
		cur += e.d
		peak = max(peak, cur)
	}
	return peak
}
