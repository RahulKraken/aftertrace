-- @id model.switch_cache_rebuild
-- @title Model switch rebuilt the cache
-- @pillar cost
-- @min_version 2.1.0

WITH m AS (
  SELECT *, lag(model) OVER (PARTITION BY session_id ORDER BY start_ns) AS prev_model,
            lag(effort) OVER (PARTITION BY session_id ORDER BY start_ns) AS prev_effort
  FROM llm
  WHERE agent_id IS NULL AND coalesce(query_source,'') <> 'compact' AND NOT is_error
)
SELECT
  'low' AS severity,
  'Switching ' || prev_model || ' to ' || model || ' mid-session rebuilt the prompt cache' AS headline,
  coalesce(cost_usd, 0) AS impact_value,
  'USD on the rebuild request' AS impact_unit,
  'The first ' || model || ' request wrote ' || CAST(cache_creation_tokens AS BIGINT) ||
    ' tokens to cache and read none. Effort went ' || coalesce(prev_effort, 'none') || ' to ' || coalesce(effort, 'none') || '.' AS detail,
  'Prompt caches are per model. Pick the model at session start, or switch at a /clear boundary. For a one-off hard step, delegate it to a subagent on the bigger model instead.' AS recommendation,
  json_array(json_object('trace_id', trace_id, 'span_id', span_id, 'label',
    'switched to ' || model || ', cache rebuilt'))::VARCHAR AS evidence,
  json_array(session_id)::VARCHAR AS sessions
FROM m
WHERE prev_model IS NOT NULL AND prev_model <> model AND cache_read_tokens = 0;
