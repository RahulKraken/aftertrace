-- @id permission.allow_rule_candidate
-- @title Allow rule would remove repeated prompts
-- @pillar bottleneck
-- @min_version 2.1.0

WITH waits AS (
  SELECT
    CASE
      WHEN tool_name <> 'Bash' THEN tool_name
      WHEN full_command IS NOT NULL AND length(trim(full_command)) > 0 THEN
        'Bash(' || array_to_string((string_split(full_command, ' '))[1:least(2, len(string_split(full_command, ' ')))], ' ') || ':*)'
      WHEN bash_argv0 IS NOT NULL AND bash_argv0 <> 'other' THEN
        'Bash(' || bash_argv0 || ':*)'
      ELSE NULL
    END AS pattern,
    trace_id, wait_span_id, wait_ms, session_id, full_command, bash_argv0
  FROM tools
  WHERE decision = 'accept'
    AND decision_source IN ('user_temporary', 'user_permanent')
    AND wait_span_id IS NOT NULL
),
ok AS (
  SELECT * FROM waits
  WHERE pattern IS NOT NULL
    AND coalesce(full_command, '') NOT LIKE 'rm %'
    AND coalesce(full_command, '') NOT LIKE 'rm\t%'
    AND coalesce(full_command, '') NOT LIKE 'git push%'
    AND coalesce(bash_argv0, '') NOT IN ('rm')
),
g AS (
  SELECT
    pattern,
    count(*) AS n,
    sum(wait_ms) AS wait_ms,
    to_json(list(DISTINCT session_id)) AS sessions,
    to_json(list({'trace_id': trace_id, 'span_id': wait_span_id, 'label':
      'blocked_on_user ' || printf('%.1f', wait_ms/1000.0) || 's'} ORDER BY wait_ms DESC)) AS evidence
  FROM ok
  GROUP BY pattern
  HAVING count(*) >= 3
)
SELECT
  CASE WHEN wait_ms/1000.0 > 60 THEN 'high' ELSE 'medium' END AS severity,
  n || ' permission prompts for ' || pattern || ', all approved' AS headline,
  wait_ms/1000.0 AS impact_value,
  's waited' AS impact_unit,
  'You approved ' || pattern || ' ' || n || ' times in ' || json_array_length(sessions) ||
    ' session(s). Waiting on you cost ' || printf('%.0f', wait_ms/1000.0) || 's of wall clock.' AS detail,
  'Add "' || pattern || '" to permissions.allow in ~/.claude/settings.json, or choose "Yes, and don''t ask again" next time.' AS recommendation,
  evidence::VARCHAR AS evidence,
  sessions::VARCHAR AS sessions
FROM g;
