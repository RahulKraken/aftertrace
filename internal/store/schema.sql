CREATE TABLE IF NOT EXISTS spans (
  trace_id VARCHAR NOT NULL,
  span_id VARCHAR NOT NULL,
  parent_span_id VARCHAR,
  name VARCHAR NOT NULL,
  start_ns BIGINT NOT NULL,
  end_ns BIGINT NOT NULL,
  duration_ms DOUBLE NOT NULL,
  is_error BOOLEAN NOT NULL,
  status_message VARCHAR,
  session_id VARCHAR,
  attrs JSON,
  resource JSON,
  PRIMARY KEY (trace_id, span_id)
);

CREATE TABLE IF NOT EXISTS span_events (
  trace_id VARCHAR NOT NULL,
  span_id VARCHAR NOT NULL,
  name VARCHAR NOT NULL,
  time_ns BIGINT NOT NULL,
  attrs JSON,
  PRIMARY KEY (trace_id, span_id, name, time_ns)
);

CREATE TABLE IF NOT EXISTS events (
  ts_ns BIGINT NOT NULL,
  name VARCHAR NOT NULL,
  session_id VARCHAR,
  prompt_id VARCHAR,
  trace_id VARCHAR,
  span_id VARCHAR,
  request_id VARCHAR,
  tool_use_id VARCHAR,
  attrs JSON,
  resource JSON
);

CREATE TABLE IF NOT EXISTS metric_points (
  name VARCHAR NOT NULL,
  unit VARCHAR,
  ts_ns BIGINT NOT NULL,
  value DOUBLE NOT NULL,
  session_id VARCHAR,
  attrs JSON,
  resource JSON
);

CREATE INDEX IF NOT EXISTS spans_session ON spans (session_id);
CREATE INDEX IF NOT EXISTS spans_name ON spans (name);
CREATE INDEX IF NOT EXISTS spans_start ON spans (start_ns);
CREATE INDEX IF NOT EXISTS events_session ON events (session_id);
CREATE INDEX IF NOT EXISTS events_name ON events (name);
CREATE INDEX IF NOT EXISTS events_request ON events (request_id);
CREATE INDEX IF NOT EXISTS events_tool ON events (tool_use_id);
CREATE INDEX IF NOT EXISTS events_trace ON events (trace_id);
CREATE INDEX IF NOT EXISTS metric_points_ts ON metric_points (ts_ns);

-- Pre-aggregated facts. Polled endpoints read these, not raw spans.
-- Maintained on ingest; rebuilt once when opening a store that lacks them.
CREATE TABLE IF NOT EXISTS llm_facts (
  trace_id VARCHAR NOT NULL,
  span_id VARCHAR NOT NULL,
  session_id VARCHAR,
  start_ns BIGINT NOT NULL,
  model VARCHAR,
  request_id VARCHAR,
  cost_usd DOUBLE,
  input_tokens DOUBLE,
  output_tokens DOUBLE,
  cache_read_tokens DOUBLE,
  cache_creation_tokens DOUBLE,
  is_error BOOLEAN NOT NULL DEFAULT false,
  attempt DOUBLE,
  PRIMARY KEY (trace_id, span_id)
);
CREATE INDEX IF NOT EXISTS llm_facts_session ON llm_facts (session_id);
CREATE INDEX IF NOT EXISTS llm_facts_start ON llm_facts (start_ns);
CREATE INDEX IF NOT EXISTS llm_facts_request ON llm_facts (request_id);

CREATE TABLE IF NOT EXISTS trace_roots (
  trace_id VARCHAR PRIMARY KEY,
  span_id VARCHAR,
  session_id VARCHAR,
  start_ns BIGINT NOT NULL,
  end_ns BIGINT NOT NULL,
  duration_ms DOUBLE NOT NULL,
  attrs JSON,
  in_progress BOOLEAN NOT NULL,
  span_count INTEGER NOT NULL DEFAULT 0,
  wait_ms DOUBLE,
  cost_usd DOUBLE,
  tokens DOUBLE,
  requests INTEGER,
  errors INTEGER,
  tool_calls INTEGER,
  approvals INTEGER,
  breakdown JSON,
  models JSON,
  repo VARCHAR,
  entrypoint VARCHAR,
  prompt VARCHAR,
  history BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS trace_roots_session ON trace_roots (session_id);
CREATE INDEX IF NOT EXISTS trace_roots_start ON trace_roots (start_ns);

CREATE TABLE IF NOT EXISTS session_stats (
  session_id VARCHAR PRIMARY KEY,
  start_ns BIGINT NOT NULL,
  end_ns BIGINT NOT NULL,
  turns INTEGER NOT NULL,
  turn_ms DOUBLE NOT NULL,
  cost_usd DOUBLE,
  tokens DOUBLE,
  cache_hit DOUBLE,
  models JSON,
  errors INTEGER,
  retried INTEGER,
  repo VARCHAR,
  entrypoint VARCHAR,
  title VARCHAR,
  breakdown JSON,
  agents JSON,
  findings INTEGER DEFAULT 0,
  in_progress BOOLEAN,
  history BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS session_stats_start ON session_stats (start_ns);

CREATE TABLE IF NOT EXISTS day_stats (
  day_start_ns BIGINT PRIMARY KEY,
  turns INTEGER,
  turn_ms DOUBLE,
  wait_ms DOUBLE,
  cost_usd DOUBLE,
  tokens DOUBLE,
  by_model JSON
);

CREATE TABLE IF NOT EXISTS source_stats (
  name VARCHAR PRIMARY KEY,
  kind VARCHAR,
  spans BIGINT,
  events BIGINT,
  metrics BIGINT,
  first_ns BIGINT,
  last_ns BIGINT
);

CREATE TABLE IF NOT EXISTS model_stats (
  model VARCHAR PRIMARY KEY,
  cost_usd DOUBLE,
  tokens DOUBLE,
  requests BIGINT
);

CREATE TABLE IF NOT EXISTS store_meta (
  k VARCHAR PRIMARY KEY,
  v VARCHAR
);

-- Claude Code session transcripts imported from ~/.claude/projects.
-- size+mtime skip unchanged files; status is imported, skipped_otel, empty or error.
CREATE TABLE IF NOT EXISTS history_files (
  path VARCHAR PRIMARY KEY,
  size BIGINT NOT NULL,
  mtime_ns BIGINT NOT NULL,
  session_id VARCHAR,
  status VARCHAR NOT NULL,
  turns INTEGER,
  requests INTEGER,
  imported_at_ns BIGINT NOT NULL
);
