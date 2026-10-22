-- @id retry.exhausted
-- @title Retries exhausted
-- @pillar bottleneck
-- @min_version 2.1.0

SELECT
  'high' AS severity,
  'An API request gave up after ' || CAST(n(e.attrs,'total_attempts') AS INTEGER) || ' attempts' AS headline,
  n(e.attrs,'total_retry_duration_ms') / 1000.0 AS impact_value,
  's stalled' AS impact_unit,
  'HTTP ' || coalesce(a(e.attrs,'status_code'), '?') || '. ' ||
    CASE WHEN EXISTS (SELECT 1 FROM events r WHERE r.session_id=e.session_id AND r.name='api_request' AND r.ts_ns > e.ts_ns)
      THEN 'The session recovered with a later request.'
      ELSE 'No later request in this session, so the work likely stalled.'
    END AS detail,
  'Re-run the turn. If this repeats, raise CLAUDE_CODE_MAX_RETRIES (cap 15) or set CLAUDE_CODE_RETRY_WATCHDOG for unattended runs.' AS recommendation,
  json_array(json_object('trace_id', e.trace_id, 'span_id', s.span_id, 'label',
    'gave up after ' || CAST(n(e.attrs,'total_attempts') AS INTEGER) || ' attempts'))::VARCHAR AS evidence,
  json_array(e.session_id)::VARCHAR AS sessions
FROM events e
LEFT JOIN spans s ON s.trace_id=e.trace_id AND s.name='claude_code.llm_request' AND s.is_error
WHERE e.name='api_retries_exhausted';
