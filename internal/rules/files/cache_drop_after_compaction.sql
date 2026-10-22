-- @id cache.drop_after_compaction
-- @title Cache drop after compaction
-- @pillar cost
-- @min_version 2.1.0

WITH comps AS (
  SELECT session_id, ts_ns, trace_id, span_id,
    n(attrs,'pre_tokens') AS pre_tokens,
    n(attrs,'post_tokens') AS post_tokens,
    a(attrs,'trigger') AS trigger
  FROM events
  WHERE name='compaction' AND a(attrs,'success')='true'
),
main_llm AS (
  SELECT * FROM llm
  WHERE agent_id IS NULL AND coalesce(query_source,'') <> 'compact'
),
before AS (
  SELECT c.session_id, c.ts_ns,
    avg(t.cache_read_tokens / nullif(t.cache_read_tokens+t.cache_creation_tokens+t.input_tokens, 0)) AS avg_hit
  FROM comps c,
  LATERAL (
    SELECT cache_read_tokens, cache_creation_tokens, input_tokens
    FROM main_llm
    WHERE session_id = c.session_id AND end_ns < c.ts_ns
    ORDER BY end_ns DESC
    LIMIT 5
  ) t
  GROUP BY c.session_id, c.ts_ns
),
after AS (
  SELECT c.session_id, c.ts_ns, m.trace_id, m.span_id,
    m.cache_read_tokens / nullif(m.cache_read_tokens+m.cache_creation_tokens+m.input_tokens, 0) AS cache_hit,
    m.cost_usd
  FROM comps c,
  LATERAL (
    SELECT * FROM main_llm
    WHERE session_id = c.session_id AND start_ns >= c.ts_ns
    ORDER BY start_ns
    LIMIT 1
  ) m
)
SELECT
  'medium' AS severity,
  'Cache hit rate fell from ' || printf('%.0f', b.avg_hit*100) || '% to ' || printf('%.0f', a.cache_hit*100) ||
    '% after ' || c.trigger || ' compaction' AS headline,
  coalesce((SELECT sum(cost_usd) FROM llm WHERE session_id=c.session_id AND query_source='compact'
            AND end_ns BETWEEN c.ts_ns - 120000000000 AND c.ts_ns), 0)
    + coalesce(a.cost_usd, 0) AS impact_value,
  'USD on compaction and cache rewrite' AS impact_unit,
  'Compaction cut context from ' || CAST(c.pre_tokens AS BIGINT) || ' to ' || CAST(c.post_tokens AS BIGINT) ||
    ' tokens. The next request rewrote the prompt cache.' AS detail,
  'Expected once per compaction. If it happens often, start a fresh session at natural breakpoints, run /compact yourself between tasks, and keep large tool output out of the main thread by delegating exploration to a subagent.' AS recommendation,
  json_array(
    json_object('trace_id', c.trace_id, 'span_id', c.span_id, 'label', 'compaction'),
    json_object('trace_id', a.trace_id, 'span_id', a.span_id, 'label', 'next call, ' || printf('%.0f', a.cache_hit*100) || '% cached')
  )::VARCHAR AS evidence,
  json_array(c.session_id)::VARCHAR AS sessions
FROM comps c
JOIN before b ON b.session_id=c.session_id AND b.ts_ns=c.ts_ns
JOIN after a ON a.session_id=c.session_id AND a.ts_ns=c.ts_ns
WHERE b.avg_hit IS NOT NULL AND a.cache_hit IS NOT NULL AND (b.avg_hit - a.cache_hit) >= 0.3;
