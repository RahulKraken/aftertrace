-- @id cache.drop_after_compaction
-- @title Cache drop after compaction
-- @pillar cost
-- @min_version 2.1.0

-- Live OTel compaction events carry success, pre_tokens and post_tokens.
-- History import has the compact_boundary but not those numbers; missing
-- success is treated as true, and missing pre/post are the cache reads on
-- the calls immediately before and after. The hit-rate window (five calls
-- before, one after, 30 point drop) is unchanged, so live OTel matches as
-- before.

WITH comps AS (
  SELECT session_id, ts_ns, trace_id, span_id,
    n(attrs,'pre_tokens') AS pre_tokens,
    n(attrs,'post_tokens') AS post_tokens,
    coalesce(a(attrs,'trigger'), 'auto') AS trigger
  FROM events
  WHERE name='compaction' AND coalesce(a(attrs,'success'), 'true')='true'
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
prev_read AS (
  SELECT c.session_id, c.ts_ns, m.cache_read_tokens AS pre_read
  FROM comps c,
  LATERAL (
    SELECT cache_read_tokens FROM main_llm
    WHERE session_id = c.session_id AND end_ns < c.ts_ns
    ORDER BY end_ns DESC
    LIMIT 1
  ) m
),
after AS (
  SELECT c.session_id, c.ts_ns, m.trace_id, m.span_id,
    m.cache_read_tokens / nullif(m.cache_read_tokens+m.cache_creation_tokens+m.input_tokens, 0) AS cache_hit,
    m.cache_read_tokens,
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
  'Compaction cut context from ' || CAST(coalesce(c.pre_tokens, p.pre_read) AS BIGINT) || ' to ' ||
    CAST(coalesce(c.post_tokens, a.cache_read_tokens) AS BIGINT) ||
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
LEFT JOIN prev_read p ON p.session_id=c.session_id AND p.ts_ns=c.ts_ns
WHERE b.avg_hit IS NOT NULL AND a.cache_hit IS NOT NULL AND (b.avg_hit - a.cache_hit) >= 0.3;
