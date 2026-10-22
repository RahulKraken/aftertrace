package query

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/duckdb/duckdb-go/v2"
)

var aggs = map[string]string{
	"COUNT": "count(*)",
	"SUM":   "sum({f})",
	"AVG":   "avg({f})",
	"MIN":   "min({f})",
	"MAX":   "max({f})",
	"P50":   "quantile_cont({f}, 0.5)",
	"P95":   "quantile_cont({f}, 0.95)",
	"P99":   "quantile_cont({f}, 0.99)",
}

var ops = map[string]bool{
	"=": true, "!=": true, ">": true, "<": true, ">=": true, "<=": true,
	"contains": true, "exists": true, "not exists": true,
}

var columns = map[string][2]string{
	"duration_ms": {"duration_ms", "num"},
	"name":        {"name", "str"},
	"cost_usd":    {"cost_usd", "num"},
	"session.id":  {"session_id", "str"},
	"trace_id":    {"trace_id", "str"},
	"is_error":    {"CAST(is_error AS VARCHAR)", "str"},
}

var aliases = map[string]string{"repo": "vcs.repository.name"}

type Field struct {
	Key  string `json:"key"`
	Kind string `json:"kind"`
}

type Builder struct {
	Agg     string   `json:"agg"`
	Field   string   `json:"field"`
	Where   []Where  `json:"where"`
	GroupBy []string `json:"group_by"`
	Order   string   `json:"order"`
	Limit   int      `json:"limit"`
	FromNS  *int64   `json:"from_ns"`
	ToNS    *int64   `json:"to_ns"`
}

type Where struct {
	Field string `json:"field"`
	Op    string `json:"op"`
	Value any    `json:"value"`
}

type Result struct {
	SQL    string     `json:"sql"`
	Params []any      `json:"params"`
	Table  []TableRow `json:"table"`
	Series []Series   `json:"series"`
	StepNS int64      `json:"step_ns"`
	Lo     *int64     `json:"lo"`
	Hi     *int64     `json:"hi"`
}

type TableRow struct {
	Groups []any `json:"groups"`
	Value  any   `json:"value"`
	N      int64 `json:"n"`
}

type Series struct {
	Groups []any    `json:"groups"`
	Points [][2]any `json:"points"`
}

type TraceHit struct {
	TraceID   string  `json:"trace_id"`
	SpanID    string  `json:"span_id"`
	Matches   int64   `json:"matches"`
	MaxMS     float64 `json:"max_ms"`
	SessionID string  `json:"session_id"`
	StartNS   int64   `json:"start_ns"`
	TurnMS    float64 `json:"turn_ms"`
	Repo      string  `json:"repo"`
}

// Fields lists the query builder's fields: the fixed columns plus every
// attribute key on spans and api_request events, typed num when every value
// casts to a number. One pass over the data; the result is cached briefly
// because the Query page asks for it on every load and the scan grows with
// the store.
func Fields(db *sql.DB) (map[string]Field, error) {
	fieldsCache.mu.Lock()
	defer fieldsCache.mu.Unlock()
	if fieldsCache.db == db && time.Since(fieldsCache.at) < 30*time.Second {
		return fieldsCache.out, nil
	}
	out, err := scanFields(db)
	if err != nil {
		return nil, err
	}
	fieldsCache.db, fieldsCache.at, fieldsCache.out = db, time.Now(), out
	return out, nil
}

var fieldsCache struct {
	mu  sync.Mutex
	db  *sql.DB
	at  time.Time
	out map[string]Field
}

func scanFields(db *sql.DB) (map[string]Field, error) {
	out := map[string]Field{}
	for k, v := range columns {
		out[k] = Field{Key: k, Kind: v[1]}
	}
	rows, err := db.Query(`
		WITH kv AS (
			SELECT unnest(json_keys(attrs)) AS k, attrs AS j FROM spans
			UNION ALL
			SELECT unnest(json_keys(attrs)) AS k, attrs AS j FROM events WHERE name = 'api_request'
		)
		SELECT k,
			count(*) FILTER (WHERE TRY_CAST(json_extract_string(j, '$."' || k || '"') AS DOUBLE) IS NULL
				AND json_extract_string(j, '$."' || k || '"') IS NOT NULL),
			count(json_extract_string(j, '$."' || k || '"'))
		FROM kv GROUP BY k ORDER BY k`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var k string
		var nullish, n int
		if err := rows.Scan(&k, &nullish, &n); err != nil {
			return nil, err
		}
		if _, ok := out[k]; ok {
			continue
		}
		kind := "str"
		if n > 0 && nullish == 0 && !strings.HasSuffix(k, "_id") && k != "event.sequence" {
			kind = "num"
		}
		out[k] = Field{Key: k, Kind: kind}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out["repo"] = Field{Key: "repo", Kind: "str"}
	return out, nil
}

func expr(key string, known map[string]Field, numeric bool) (string, error) {
	if a, ok := aliases[key]; ok {
		key = a
	}
	if c, ok := columns[key]; ok {
		return c[0], nil
	}
	if _, ok := known[key]; !ok {
		return "", fmt.Errorf("unknown field %s", key)
	}
	safe := strings.ReplaceAll(key, "'", "''")
	e := fmt.Sprintf("coalesce(a(attrs,'%s'), a(event_attrs,'%s'))", safe, safe)
	if numeric {
		return "TRY_CAST(" + e + " AS DOUBLE)", nil
	}
	return e, nil
}

func whereSQL(q Builder, known map[string]Field) (string, []any, error) {
	var clauses []string
	var params []any
	for _, w := range q.Where {
		if !ops[w.Op] {
			return "", nil, fmt.Errorf("unknown op %s", w.Op)
		}
		num := w.Op == ">" || w.Op == "<" || w.Op == ">=" || w.Op == "<="
		e, err := expr(w.Field, known, num)
		if err != nil {
			return "", nil, err
		}
		switch w.Op {
		case "exists":
			clauses = append(clauses, e+" IS NOT NULL")
		case "not exists":
			clauses = append(clauses, e+" IS NULL")
		case "contains":
			clauses = append(clauses, e+" ILIKE ?")
			params = append(params, "%"+fmt.Sprint(w.Value)+"%")
		default:
			clauses = append(clauses, e+" "+w.Op+" ?")
			if num {
				params = append(params, asFloat(w.Value))
			} else {
				params = append(params, fmt.Sprint(w.Value))
			}
		}
	}
	if q.FromNS != nil {
		clauses = append(clauses, "start_ns >= ?")
		params = append(params, *q.FromNS)
	}
	if q.ToNS != nil {
		clauses = append(clauses, "start_ns < ?")
		params = append(params, *q.ToNS)
	}
	if len(clauses) == 0 {
		return "TRUE", params, nil
	}
	return strings.Join(clauses, " AND "), params, nil
}

func compile(q Builder, known map[string]Field) (sqlText string, params []any, groups []string, agg string, err error) {
	op := strings.ToUpper(q.Agg)
	if op == "" {
		op = "COUNT"
	}
	tmpl, ok := aggs[op]
	if !ok {
		return "", nil, nil, "", fmt.Errorf("unknown agg %s", op)
	}
	var f string
	if op != "COUNT" {
		f, err = expr(q.Field, known, true)
		if err != nil {
			return "", nil, nil, "", err
		}
	}
	agg = strings.ReplaceAll(tmpl, "{f}", f)
	for i, g := range q.GroupBy {
		if i >= 2 {
			break
		}
		e, err := expr(g, known, false)
		if err != nil {
			return "", nil, nil, "", err
		}
		groups = append(groups, e)
	}
	w, params, err := whereSQL(q, known)
	if err != nil {
		return "", nil, nil, "", err
	}
	var sel []string
	for i, g := range groups {
		sel = append(sel, fmt.Sprintf("%s AS g%d", g, i))
	}
	sel = append(sel, agg+" AS value", "count(*) AS n")
	gb := ""
	if len(groups) > 0 {
		parts := make([]string, len(groups))
		for i := range groups {
			parts[i] = fmt.Sprintf("g%d", i)
		}
		gb = "GROUP BY " + strings.Join(parts, ", ")
	}
	order := "value DESC"
	if q.Order == "asc" {
		order = "value ASC"
	}
	limit := q.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 500 {
		limit = 500
	}
	sqlText = fmt.Sprintf("SELECT %s\nFROM q_spans\nWHERE %s\n%s\nORDER BY %s NULLS LAST\nLIMIT %d",
		strings.Join(sel, ", "), w, gb, order, limit)
	return sqlText, params, groups, agg, nil
}

func Run(db *sql.DB, q Builder, known map[string]Field) (*Result, error) {
	sqlText, params, groups, agg, err := compile(q, known)
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(sqlText, params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var table []TableRow
	for rows.Next() {
		gvals := make([]any, len(groups))
		scan := make([]any, len(groups)+2)
		for i := range gvals {
			var v any
			gvals[i] = &v
			scan[i] = &v
		}
		var value any
		var n int64
		scan[len(groups)] = &value
		scan[len(groups)+1] = &n
		if err := rows.Scan(scan...); err != nil {
			return nil, err
		}
		gs := make([]any, len(groups))
		for i := range groups {
			gs[i] = *(gvals[i].(*any))
		}
		table = append(table, TableRow{Groups: gs, Value: value, N: n})
	}
	if table == nil {
		table = []TableRow{}
	}

	w, p, err := whereSQL(q, known)
	if err != nil {
		return nil, err
	}
	var lo, hi sql.NullInt64
	if err := db.QueryRow(fmt.Sprintf("SELECT min(start_ns), max(start_ns) FROM q_spans WHERE %s", w), p...).Scan(&lo, &hi); err != nil {
		return nil, err
	}
	out := &Result{SQL: sqlText, Params: params, Table: table, Series: []Series{}}
	if !lo.Valid {
		return out, nil
	}
	loV, hiV := lo.Int64, hi.Int64+1
	if q.FromNS != nil {
		loV = *q.FromNS
	}
	if q.ToNS != nil {
		hiV = *q.ToNS
	}
	span := hiV - loV
	const day, hour int64 = 86_400_000_000_000, 3_600_000_000_000
	var step int64
	switch {
	case span > 3*day:
		step = day
	case span > 12*hour:
		step = hour
	default:
		step = span / 40
		if step < 60_000_000_000 {
			step = 60_000_000_000
		}
	}
	if step == day || step == hour {
		loV = loV - loV%step
	}
	top := table
	if len(groups) > 0 {
		if len(top) > 5 {
			top = top[:5]
		}
	} else {
		top = []TableRow{{Groups: []any{}}}
	}
	for _, t := range top {
		gw, gp := w, append([]any{}, p...)
		for i, g := range groups {
			var v any
			if i < len(t.Groups) {
				v = t.Groups[i]
			}
			gw += fmt.Sprintf(" AND %s IS NOT DISTINCT FROM ?", g)
			gp = append(gp, v)
		}
		pts, err := db.Query(fmt.Sprintf(`SELECT (%d + ((start_ns - %d) // %d) * %d) AS b, %s FROM q_spans
			WHERE %s GROUP BY b ORDER BY b`, loV, loV, step, step, agg, gw), gp...)
		if err != nil {
			return nil, err
		}
		var points [][2]any
		for pts.Next() {
			var b int64
			var v any
			if err := pts.Scan(&b, &v); err != nil {
				pts.Close()
				return nil, err
			}
			points = append(points, [2]any{b, v})
		}
		pts.Close()
		if points == nil {
			points = [][2]any{}
		}
		out.Series = append(out.Series, Series{Groups: t.Groups, Points: points})
	}
	out.StepNS = step
	out.Lo = &loV
	out.Hi = &hiV
	return out, nil
}

func Traces(db *sql.DB, q Builder, known map[string]Field, groupValues []any, bucket []int64) ([]TraceHit, error) {
	w, params, err := whereSQL(q, known)
	if err != nil {
		return nil, err
	}
	n := len(q.GroupBy)
	if n > 2 {
		n = 2
	}
	if n > len(groupValues) {
		n = len(groupValues)
	}
	for i := 0; i < n; i++ {
		e, err := expr(q.GroupBy[i], known, false)
		if err != nil {
			return nil, err
		}
		w += fmt.Sprintf(" AND %s IS NOT DISTINCT FROM ?", e)
		params = append(params, groupValues[i])
	}
	if len(bucket) == 2 {
		w += " AND start_ns >= ? AND start_ns < ?"
		params = append(params, bucket[0], bucket[1])
	}
	rows, err := db.Query(fmt.Sprintf(`
		WITH m AS (SELECT trace_id, span_id, start_ns, duration_ms FROM q_spans WHERE %s)
		SELECT m.trace_id, arg_max(m.span_id, m.duration_ms), count(*), max(m.duration_ms),
			any_value(r.session_id), any_value(r.start_ns), any_value(r.duration_ms), any_value(a(r.attrs,'vcs.repository.name'))
		FROM m LEFT JOIN spans r ON r.trace_id=m.trace_id AND r.name='claude_code.interaction'
		GROUP BY m.trace_id ORDER BY max(m.duration_ms) DESC LIMIT 50`, w), params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TraceHit
	for rows.Next() {
		var h TraceHit
		var sid, repo sql.NullString
		var start sql.NullInt64
		var turn sql.NullFloat64
		if err := rows.Scan(&h.TraceID, &h.SpanID, &h.Matches, &h.MaxMS, &sid, &start, &turn, &repo); err != nil {
			return nil, err
		}
		h.SessionID = sid.String
		h.StartNS = start.Int64
		h.TurnMS = turn.Float64
		h.Repo = repo.String
		out = append(out, h)
	}
	if out == nil {
		out = []TraceHit{}
	}
	return out, rows.Err()
}

// FieldValues returns up to limit distinct non-empty values of a known field, sorted, for the
// query builder's value picker. The key must be in known; it never reaches SQL unchecked.
func FieldValues(db *sql.DB, key string, known map[string]Field, limit int) ([]string, error) {
	e, err := expr(key, known, false)
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(fmt.Sprintf(`SELECT DISTINCT CAST(%s AS VARCHAR) AS v FROM q_spans
		WHERE v IS NOT NULL AND v <> '' ORDER BY v LIMIT ?`, e), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

var readonlyOK = regexp.MustCompile(`(?is)^\s*(with|select)\b`)

var errReadOnly = errors.New("Only a single SELECT or WITH statement is allowed.")

type SQLResult struct {
	Columns []string `json:"columns"`
	Rows    [][]any  `json:"rows"`
}

func RunSQL(db *sql.DB, sqlText string, limit int) (*SQLResult, error) {
	s := strings.TrimSpace(strings.TrimRight(sqlText, ";"))
	if strings.Contains(s, ";") || !readonlyOK.MatchString(s) {
		return nil, errReadOnly
	}
	if limit <= 0 {
		limit = 500
	}
	ctx := context.Background()
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	// The regex is a cheap first pass. DuckDB's own parse decides: WITH ... INSERT passes the regex.
	if err := conn.Raw(func(dc any) error {
		st, err := dc.(driver.ConnPrepareContext).PrepareContext(ctx, s)
		if err != nil {
			return err
		}
		defer st.Close()
		t, err := st.(*duckdb.Stmt).StatementType()
		if err != nil {
			return err
		}
		if t != duckdb.STATEMENT_TYPE_SELECT {
			return errReadOnly
		}
		return nil
	}); err != nil {
		return nil, err
	}
	// Rolled back, never committed, so a write that slips past the checks does not persist.
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	rows, err := tx.Query(s)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	out := &SQLResult{Columns: cols, Rows: [][]any{}}
	n := 0
	for rows.Next() {
		if n >= limit {
			break
		}
		raw := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range raw {
			ptrs[i] = &raw[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		out.Rows = append(out.Rows, normalizeRow(raw))
		n++
	}
	return out, rows.Err()
}

func normalizeRow(raw []any) []any {
	out := make([]any, len(raw))
	for i, v := range raw {
		switch t := v.(type) {
		case []byte:
			out[i] = string(t)
		default:
			out[i] = t
		}
	}
	return out
}

func asFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case string:
		var f float64
		fmt.Sscanf(t, "%f", &f)
		return f
	default:
		var f float64
		fmt.Sscanf(fmt.Sprint(v), "%f", &f)
		return f
	}
}
