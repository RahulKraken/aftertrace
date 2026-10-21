-- @id tool.repeated_errors
-- @title Repeated tool failures
-- @pillar bottleneck
-- @min_version 2.1.268

SELECT
  'medium' AS severity,
  tool_name || ' failed ' || count(*) || ' times with ' || coalesce(error_class, 'error') || ' in one session' AS headline,
  sum(exec_ms)/1000.0 AS impact_value,
  's spent on failing runs' AS impact_unit,
  'Target: ' || coalesce(full_command, bash_argv0, tool_name) || '. Each failure costs a model round trip to read and react to the error.' AS detail,
  'If the failure is environmental (missing deps, wrong cwd), fix it once and record the fix in CLAUDE.md so the model stops rediscovering it.' AS recommendation,
  to_json(list({'trace_id': trace_id, 'span_id': exec_span_id, 'label': coalesce(error_class, 'error')}
    ORDER BY start_ns))::VARCHAR AS evidence,
  json_array(session_id)::VARCHAR AS sessions
FROM tools
WHERE success='false'
GROUP BY session_id, tool_name, coalesce(full_command, bash_argv0, tool_name), error_class
HAVING count(*) >= 2;
