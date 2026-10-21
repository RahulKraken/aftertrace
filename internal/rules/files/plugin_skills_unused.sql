-- @id plugin.skills_unused
-- @title Plugin skills never used
-- @pillar config
-- @min_version 2.1.273

WITH loaded AS (
  SELECT a(attrs,'plugin.name') AS plugin, count(DISTINCT session_id) AS n_sessions, max(n(attrs,'skill_path_count')) AS paths
  FROM events
  WHERE name='plugin_loaded' AND n(attrs,'skill_path_count') > 0
    AND a(attrs,'plugin.name') NOT IN ('third-party')
  GROUP BY 1
)
SELECT
  'low' AS severity,
  'Plugin ' || plugin || ' loaded in ' || n_sessions || ' sessions, its skills never activated' AS headline,
  n_sessions AS impact_value,
  'sessions' AS impact_unit,
  plugin || ' declares ' || CAST(paths AS INTEGER) || ' skill directories. No skill_activated event names it.' AS detail,
  'Disable ' || plugin || ' if you don''t use it. Each loaded skill puts its description in context on every request (inferred, not measured by telemetry).' AS recommendation,
  '[]'::VARCHAR AS evidence,
  '[]'::VARCHAR AS sessions
FROM loaded
WHERE n_sessions >= 3
  AND (SELECT count(*) FROM events WHERE name='skill_activated' AND a(attrs,'plugin.name')=plugin) = 0;
