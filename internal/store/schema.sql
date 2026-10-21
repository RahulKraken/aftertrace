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
CREATE INDEX IF NOT EXISTS events_session ON events (session_id);
CREATE INDEX IF NOT EXISTS events_name ON events (name);
CREATE INDEX IF NOT EXISTS events_request ON events (request_id);
CREATE INDEX IF NOT EXISTS events_tool ON events (tool_use_id);
CREATE INDEX IF NOT EXISTS events_trace ON events (trace_id);
