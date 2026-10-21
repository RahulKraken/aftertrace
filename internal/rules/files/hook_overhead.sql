-- @id hook.overhead
-- @title Slow hooks
-- @pillar bottleneck
-- @min_version 2.1.0

WITH h AS (
  SELECT a(e.attrs,'hook_name') AS hook_name, count(*) AS n,
    sum(n(e.attrs,'total_duration_ms')) AS total_ms,
    avg(n(e.attrs,'total_duration_ms')) AS avg_ms,
    to_json(list({'trace_id': e.trace_id, 'span_id': e.span_id, 'label': 'turn with hook'})) AS evidence,
    to_json(list(DISTINCT e.session_id)) AS sessions
  FROM events e
  WHERE e.name='hook_execution_complete'
  GROUP BY 1
)
SELECT
  CASE WHEN total_ms > 10000 THEN 'medium' ELSE 'low' END AS severity,
  'Hook ' || hook_name || ' averages ' || printf('%.1f', avg_ms/1000.0) || 's per run' AS headline,
  total_ms/1000.0 AS impact_value,
  's in hooks' AS impact_unit,
  n || ' runs. Hooks block the tool call they guard.' AS detail,
  'Narrow the matcher for ' || hook_name || ' so it runs on fewer calls, or move slow work to PostToolUse or an async check.' AS recommendation,
  evidence::VARCHAR AS evidence,
  sessions::VARCHAR AS sessions
FROM h
WHERE avg_ms >= 1000;
