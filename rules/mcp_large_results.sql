-- @id mcp.large_results
-- @title Large MCP tool results
-- @pillar cost
-- @min_version 2.1.273

WITH mcp AS (
  SELECT tool_name, count(*) AS n, sum(result_tokens) AS toks,
    to_json(list({'trace_id': trace_id, 'span_id': span_id, 'label': tool_name} ORDER BY result_tokens DESC)) AS evidence,
    to_json(list(DISTINCT session_id)) AS sessions
  FROM tools
  WHERE tool_name LIKE 'mcp__%' AND result_tokens > 10000
  GROUP BY tool_name
)
SELECT
  'medium' AS severity,
  tool_name || ' returned ' || CAST(toks AS BIGINT) || ' tokens over ' || n || ' calls' AS headline,
  coalesce((SELECT sum(cost_usd) FROM llm
            WHERE mcp_server_name = split_part(m.tool_name, '__', 2)
              AND mcp_tool_name = split_part(m.tool_name, '__', 3)), 0) AS impact_value,
  'USD on requests that consumed them' AS impact_unit,
  'Each result over 10k tokens stays in context for the rest of the session and is re-read from cache on every later request.' AS detail,
  'Ask for narrower results (filters, limits, fields) from ' || split_part(tool_name, '__', 2) ||
    ', or call it from a subagent so only a summary reaches the main thread.' AS recommendation,
  evidence::VARCHAR AS evidence,
  sessions::VARCHAR AS sessions
FROM mcp m;
