-- @id model.opus_downgrade
-- @title Opus on tiny turns
-- @pillar cost
-- @min_version 2.1.0

-- Claude Code turns on an Opus model that never call a tool, grouped by
-- project (vcs.repository.name). Fires when there are at least 10 such
-- turns and 90% of their main-thread outputs are under 80 tokens: short
-- answers, routing, "yes"/"ok", no exploration. Same spirit as
-- app.model_downgrade (90% of outputs under 60-100 tokens, n >= 10).
--
-- Impact is what those tokens would have saved on claude-haiku-5-5, using
-- the prices table. The detail also shows the same tokens on
-- claude-sonnet-5-5. History import records model, tokens and cost, so this
-- runs on session files as well as live OTel.

WITH turns AS (
  SELECT
    i.session_id, i.trace_id, i.span_id,
    coalesce(a(i.attrs, 'vcs.repository.name'), 'unknown') AS project,
    (SELECT l.model FROM llm l
      WHERE l.trace_id = i.trace_id AND l.agent_id IS NULL
        AND coalesce(l.query_source, '') NOT IN ('compact', 'subagent')
      ORDER BY l.start_ns DESC LIMIT 1) AS model,
    (SELECT sum(coalesce(l.output_tokens, 0)) FROM llm l
      WHERE l.trace_id = i.trace_id AND l.agent_id IS NULL
        AND coalesce(l.query_source, '') NOT IN ('compact', 'subagent')) AS out_tok,
    (SELECT sum(coalesce(l.input_tokens, 0)) FROM llm l
      WHERE l.trace_id = i.trace_id AND l.agent_id IS NULL
        AND coalesce(l.query_source, '') NOT IN ('compact', 'subagent')) AS in_uncached,
    (SELECT sum(coalesce(l.cache_read_tokens, 0)) FROM llm l
      WHERE l.trace_id = i.trace_id AND l.agent_id IS NULL
        AND coalesce(l.query_source, '') NOT IN ('compact', 'subagent')) AS in_read,
    (SELECT sum(coalesce(l.cache_creation_tokens, 0)) FROM llm l
      WHERE l.trace_id = i.trace_id AND l.agent_id IS NULL
        AND coalesce(l.query_source, '') NOT IN ('compact', 'subagent')) AS in_write,
    (SELECT sum(coalesce(l.cost_usd, 0)) FROM llm l
      WHERE l.trace_id = i.trace_id AND l.agent_id IS NULL
        AND coalesce(l.query_source, '') NOT IN ('compact', 'subagent')) AS cost,
    (SELECT count(*) FROM tools t WHERE t.trace_id = i.trace_id) AS n_tools
  FROM spans i
  WHERE i.name = 'claude_code.interaction'
),
tiny AS (
  SELECT * FROM turns
  WHERE n_tools = 0 AND model_key(model) LIKE 'claude-opus-%' AND out_tok IS NOT NULL
),
proj AS (
  SELECT project, count(*) AS n, sum(cost) AS cost,
    quantile_cont(out_tok, 0.9) AS p90_out,
    sum(in_uncached) AS in_uncached, sum(in_read) AS in_read, sum(in_write) AS in_write,
    sum(out_tok) AS out_tok, mode(model) AS model
  FROM tiny
  GROUP BY project
  HAVING count(*) >= 10 AND quantile_cont(out_tok, 0.9) < 80
),
s AS (SELECT * FROM prices WHERE prefix = 'claude-sonnet-5-5'),
h AS (SELECT * FROM prices WHERE prefix = 'claude-haiku-5-5'),
scored AS (
  SELECT p.*,
    (p.in_uncached * s.input + p.in_write * s.cache_write + p.in_read * s.cache_read + p.out_tok * s.output) / 1e6 AS sonnet_cost,
    (p.in_uncached * h.input + p.in_write * h.cache_write + p.in_read * h.cache_read + p.out_tok * h.output) / 1e6 AS haiku_cost
  FROM proj p, s, h
)
SELECT
  CASE WHEN sc.cost - sc.haiku_cost >= 5 THEN 'high' ELSE 'medium' END AS severity,
  sc.project || ' uses ' || sc.model || ' for ' || CAST(round(sc.p90_out) AS INTEGER) || '-token turns with no tools' AS headline,
  greatest(sc.cost - sc.haiku_cost, 0) AS impact_value,
  'USD' AS impact_unit,
  sc.n || ' Opus turns with no tool use. 90% of outputs are under ' || CAST(round(sc.p90_out) AS INTEGER) ||
    ' tokens, cost $' || printf('%.2f', sc.cost) ||
    '. The same tokens on claude-sonnet-5-5 would cost $' || printf('%.2f', sc.sonnet_cost) ||
    ', on claude-haiku-5-5 $' || printf('%.2f', sc.haiku_cost) || '.' AS detail,
  'Short turns that never reach for a tool rarely need Opus. Default this project to claude-sonnet-5-5, or to claude-haiku-5-5 for routing and yes/no, and keep Opus for the turns that actually explore.' AS recommendation,
  (SELECT to_json(list({'trace_id': trace_id, 'span_id': span_id, 'label': coalesce(CAST(CAST(out_tok AS INTEGER) AS VARCHAR), '?') || ' tokens out'}))
   FROM (SELECT trace_id, span_id, out_tok FROM tiny t
         WHERE t.project = sc.project ORDER BY t.cost DESC LIMIT 5))::VARCHAR AS evidence,
  (SELECT to_json(list(DISTINCT session_id)) FROM tiny t WHERE t.project = sc.project)::VARCHAR AS sessions
FROM scored sc
WHERE sc.cost - sc.haiku_cost > 0.01;
