-- @id retry.waste
-- @title Time lost to API retries
-- @pillar bottleneck
-- @min_version 2.1.0

WITH rows AS (
  SELECT l.trace_id, l.span_id, l.session_id, l.attempt, l.model,
    (max(e.time_ns) - l.start_ns)/1e6 AS waste_ms
  FROM llm l JOIN span_events e ON e.trace_id=l.trace_id AND e.span_id=l.span_id AND e.name='gen_ai.request.attempt'
  WHERE l.attempt > 1 AND NOT l.is_error
  GROUP BY l.trace_id, l.span_id, l.session_id, l.attempt, l.model, l.start_ns
)
SELECT
  CASE WHEN sum(waste_ms)/1000.0 > 60 THEN 'high' ELSE 'medium' END AS severity,
  count(*) || ' API requests needed retries' AS headline,
  sum(waste_ms)/1000.0 AS impact_value,
  's lost to retries' AS impact_unit,
  (sum(attempt - 1)) || ' failed attempts before success. Worst: ' ||
    (SELECT CAST(attempt AS INTEGER) FROM rows ORDER BY waste_ms DESC LIMIT 1) || ' attempts, ' ||
    printf('%.1f', (SELECT waste_ms FROM rows ORDER BY waste_ms DESC LIMIT 1)/1000.0) || 's lost.' AS detail,
  'Retries are server-side or network failures, so the fix is rarely local. If they cluster in time, check status and consider a fallback model for long runs. If they cluster on one network, check your proxy.' AS recommendation,
  to_json(list({'trace_id': trace_id, 'span_id': span_id, 'label':
    '×' || CAST(attempt AS INTEGER) || ' attempts, ' || printf('%.1f', waste_ms/1000.0) || 's lost'}
    ORDER BY waste_ms DESC))::VARCHAR AS evidence,
  to_json(list(DISTINCT session_id))::VARCHAR AS sessions
FROM rows
HAVING count(*) > 0;
