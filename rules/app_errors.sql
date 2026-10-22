-- @id app.errors
-- @title Model calls failing
-- @pillar bottleneck
-- @min_version 0

-- An app where at least 3 model calls failed and at least 5% of calls did.
-- error.type (rate_limit_error, overloaded_error, ...) says which kind.
WITH s AS (
  SELECT service, count(*) AS n, count(*) FILTER (WHERE is_error OR error_type IS NOT NULL) AS failed,
    mode(error_type) FILTER (WHERE error_type IS NOT NULL) AS top_error
  FROM calls GROUP BY 1
)
SELECT
  CASE WHEN s.failed * 1.0 / s.n >= 0.15 THEN 'high' ELSE 'medium' END AS severity,
  s.service || ': ' || s.failed || ' of ' || s.n || ' model calls failed' AS headline,
  s.failed AS impact_value,
  'calls failed' AS impact_unit,
  printf('%.0f', s.failed * 100.0 / s.n) || '% of calls failed. Most common: ' || coalesce(s.top_error, 'unknown error') || '.' AS detail,
  CASE WHEN s.top_error LIKE '%rate_limit%' THEN
    'You are hitting rate limits. Retry with exponential backoff and jitter (the Claude SDKs do this; check max_retries), spread bursts out, or raise your usage tier.'
  WHEN s.top_error LIKE '%overloaded%' THEN
    'The API was overloaded. Retry with backoff, and consider a fallback model for requests that must succeed.'
  ELSE
    'Open the failed calls to see the status message, then add retries with backoff for transient errors and fix the request for the rest.'
  END AS recommendation,
  (SELECT to_json(list({'trace_id': trace_id, 'span_id': span_id, 'label': coalesce(error_type, 'error')}))
   FROM (SELECT trace_id, span_id, error_type FROM calls c WHERE c.service = s.service AND (c.is_error OR c.error_type IS NOT NULL)
         ORDER BY c.start_ns DESC LIMIT 5))::VARCHAR AS evidence,
  '[]' AS sessions
FROM s
WHERE s.failed >= 3 AND s.failed * 1.0 / s.n >= 0.05;
