package api

import (
	"database/sql"
	"encoding/json"
	"io"
	"io/fs"
	"net/http"
	"strings"

	"github.com/RahulKraken/aftertrace/internal/query"
	"github.com/RahulKraken/aftertrace/internal/rules"
	"github.com/RahulKraken/aftertrace/internal/store"
)

type Server struct {
	Store *store.Store
	Web   fs.FS
}

func New(st *store.Store, web fs.FS) http.Handler {
	s := &Server{Store: st, Web: web}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/sessions", s.getSessions)
	mux.HandleFunc("GET /api/session/{id}", s.getSession)
	mux.HandleFunc("GET /api/trace/{id}", s.getTrace)
	mux.HandleFunc("GET /api/findings", s.getFindings)
	mux.HandleFunc("GET /api/fields", s.getFields)
	mux.HandleFunc("GET /api/field-values", s.getFieldValues)
	mux.HandleFunc("GET /api/cost", s.getCost)
	mux.HandleFunc("GET /api/range", s.getRange)
	mux.HandleFunc("GET /api/ask/suggestions", s.getAskSuggestions)
	mux.HandleFunc("POST /api/query", s.postQuery)
	mux.HandleFunc("POST /api/query/traces", s.postQueryTraces)
	mux.HandleFunc("POST /api/sql", s.postSQL)
	mux.HandleFunc("POST /api/ask", s.postAsk)
	mux.HandleFunc("GET /", s.static)
	return withHeaders(mux)
}

func withHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) json(w http.ResponseWriter, v any, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func (s *Server) err(w http.ResponseWriter, err error, code int) {
	s.json(w, map[string]string{"error": err.Error()}, code)
}

func (s *Server) db() *sql.DB { return s.Store.DB }

func (s *Server) getSessions(w http.ResponseWriter, r *http.Request) {
	s.Store.Mu.Lock()
	defer s.Store.Mu.Unlock()
	out, err := sessions(s.db())
	if err != nil {
		s.err(w, err, 400)
		return
	}
	s.json(w, out, 200)
}

func (s *Server) getSession(w http.ResponseWriter, r *http.Request) {
	s.Store.Mu.Lock()
	defer s.Store.Mu.Unlock()
	out, err := sessionDetail(s.db(), r.PathValue("id"))
	if err != nil {
		s.err(w, err, 400)
		return
	}
	s.json(w, out, 200)
}

func (s *Server) getTrace(w http.ResponseWriter, r *http.Request) {
	s.Store.Mu.Lock()
	defer s.Store.Mu.Unlock()
	out, err := traceDetail(s.db(), r.PathValue("id"))
	if err != nil {
		s.err(w, err, 400)
		return
	}
	s.json(w, out, 200)
}

func (s *Server) getFindings(w http.ResponseWriter, r *http.Request) {
	s.Store.Mu.Lock()
	defer s.Store.Mu.Unlock()
	s.json(w, rules.RunAll(s.db()), 200)
}

func (s *Server) getFields(w http.ResponseWriter, r *http.Request) {
	s.Store.Mu.Lock()
	defer s.Store.Mu.Unlock()
	m, err := query.Fields(s.db())
	if err != nil {
		s.err(w, err, 400)
		return
	}
	out := make([]query.Field, 0, len(m))
	for _, f := range m {
		out = append(out, f)
	}
	s.json(w, out, 200)
}

func (s *Server) getFieldValues(w http.ResponseWriter, r *http.Request) {
	field := r.URL.Query().Get("field")
	if field == "" {
		field = "name"
	}
	s.Store.Mu.Lock()
	defer s.Store.Mu.Unlock()
	fields, err := query.Fields(s.db())
	if err != nil {
		s.err(w, err, 400)
		return
	}
	out, err := query.FieldValues(s.db(), field, fields, 30)
	if err != nil {
		s.err(w, err, 400)
		return
	}
	s.json(w, out, 200)
}

func (s *Server) getCost(w http.ResponseWriter, r *http.Request) {
	s.Store.Mu.Lock()
	defer s.Store.Mu.Unlock()
	dim := r.URL.Query().Get("dim")
	if dim == "" {
		dim = "model"
	}
	out, err := cost(s.db(), dim)
	if err != nil {
		s.err(w, err, 400)
		return
	}
	s.json(w, out, 200)
}

func (s *Server) getRange(w http.ResponseWriter, r *http.Request) {
	s.Store.Mu.Lock()
	defer s.Store.Mu.Unlock()
	var lo, hi sql.NullInt64
	if err := s.db().QueryRow("SELECT min(start_ns), max(end_ns) FROM spans").Scan(&lo, &hi); err != nil {
		s.err(w, err, 400)
		return
	}
	s.json(w, map[string]any{"lo": lo.Int64, "hi": hi.Int64}, 200)
}

func (s *Server) getAskSuggestions(w http.ResponseWriter, r *http.Request) {
	s.json(w, map[string]any{
		"agent":     "stub (Ask is opt-in and out of scope in this build)",
		"questions": []string{},
		"schema":    schemaText,
	}, 200)
}

func (s *Server) postQuery(w http.ResponseWriter, r *http.Request) {
	var q query.Builder
	if err := json.NewDecoder(r.Body).Decode(&q); err != nil {
		s.err(w, err, 400)
		return
	}
	s.Store.Mu.Lock()
	defer s.Store.Mu.Unlock()
	fields, err := query.Fields(s.db())
	if err != nil {
		s.err(w, err, 400)
		return
	}
	out, err := query.Run(s.db(), q, fields)
	if err != nil {
		s.err(w, err, 400)
		return
	}
	s.json(w, out, 200)
}

func (s *Server) postQueryTraces(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Query       query.Builder `json:"query"`
		GroupValues []any         `json:"group_values"`
		Bucket      []int64       `json:"bucket"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		s.err(w, err, 400)
		return
	}
	s.Store.Mu.Lock()
	defer s.Store.Mu.Unlock()
	fields, err := query.Fields(s.db())
	if err != nil {
		s.err(w, err, 400)
		return
	}
	out, err := query.Traces(s.db(), body.Query, fields, body.GroupValues, body.Bucket)
	if err != nil {
		s.err(w, err, 400)
		return
	}
	s.json(w, out, 200)
}

func (s *Server) postSQL(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SQL string `json:"sql"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		s.err(w, err, 400)
		return
	}
	s.Store.Mu.Lock()
	defer s.Store.Mu.Unlock()
	out, err := query.RunSQL(s.db(), body.SQL, 500)
	if err != nil {
		s.err(w, err, 400)
		return
	}
	s.json(w, out, 200)
}

func (s *Server) postAsk(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Question string `json:"question"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body)
	s.json(w, map[string]any{
		"answer":   "Ask is not enabled in this build. It is opt-in and out of scope for the backend foundation; Aftertrace never sends data out unless you turn it on later.",
		"sql":      nil,
		"result":   nil,
		"evidence": []any{},
		"builder":  nil,
	}, 200)
}

func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		s.json(w, map[string]string{"error": "not found"}, 404)
		return
	}
	if s.Web == nil {
		http.NotFound(w, r)
		return
	}
	p := strings.TrimPrefix(r.URL.Path, "/")
	if p == "" {
		p = "index.html"
	}
	f, err := s.Web.Open(p)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil || stat.IsDir() {
		http.NotFound(w, r)
		return
	}
	http.ServeContent(w, r, p, stat.ModTime(), f.(io.ReadSeeker))
}

const schemaText = `Tables (DuckDB):
spans(trace_id, span_id, parent_span_id, name, start_ns, end_ns, duration_ms, is_error, status_message, session_id, attrs JSON, resource JSON)
span_events(trace_id, span_id, name, time_ns, attrs JSON)
events(ts_ns, name, session_id, prompt_id, trace_id, span_id, request_id, tool_use_id, attrs JSON, resource JSON)
metric_points(name, unit, ts_ns, value, session_id, attrs JSON, resource JSON)
Views: llm, tools, q_spans.
Macros: a(json, key) -> string attribute, n(json, key) -> numeric attribute.`
