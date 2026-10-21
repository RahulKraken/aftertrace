CREATE OR REPLACE MACRO a(j, k) AS json_extract_string(j, '$."' || k || '"');
CREATE OR REPLACE MACRO n(j, k) AS TRY_CAST(json_extract_string(j, '$."' || k || '"') AS DOUBLE);

-- one row per API request: llm_request span joined to api_request on request_id
CREATE OR REPLACE VIEW llm AS
SELECT s.trace_id, s.span_id, s.parent_span_id, s.session_id, s.start_ns, s.end_ns, s.duration_ms, s.is_error,
  a(s.attrs,'model') AS model, a(s.attrs,'effort') AS effort, a(s.attrs,'agent_id') AS agent_id,
  a(s.attrs,'parent_agent_id') AS parent_agent_id, a(s.attrs,'query_source_safe') AS query_source_safe,
  n(s.attrs,'ttft_ms') AS ttft_ms, n(s.attrs,'attempt') AS attempt, a(s.attrs,'request_id') AS request_id,
  a(s.attrs,'error_class') AS error_class, a(s.attrs,'stop_reason') AS stop_reason,
  n(s.attrs,'input_tokens') AS input_tokens, n(s.attrs,'output_tokens') AS output_tokens,
  n(s.attrs,'cache_read_tokens') AS cache_read_tokens, n(s.attrs,'cache_creation_tokens') AS cache_creation_tokens,
  n(e.attrs,'cost_usd') AS cost_usd, a(e.attrs,'skill.name') AS skill_name, a(e.attrs,'agent.name') AS agent_name,
  a(e.attrs,'mcp_server.name') AS mcp_server_name, a(e.attrs,'mcp_tool.name') AS mcp_tool_name,
  a(e.attrs,'query_source') AS query_source, a(s.attrs,'vcs.repository.name') AS repo, e.attrs AS event_attrs
FROM spans s LEFT JOIN events e ON e.name='api_request' AND e.request_id = a(s.attrs,'request_id')
WHERE s.name='claude_code.llm_request';

-- one row per tool call: tool span + permission wait + execution + tool_use_id
CREATE OR REPLACE VIEW tools AS
SELECT t.trace_id, t.span_id, t.session_id, t.start_ns, t.end_ns, t.duration_ms,
  a(t.attrs,'tool_name') AS tool_name, a(t.attrs,'tool_use_id') AS tool_use_id, a(t.attrs,'agent_id') AS agent_id,
  a(t.attrs,'bash_argv0') AS bash_argv0, a(t.attrs,'bash_command_class') AS bash_command_class,
  a(t.attrs,'full_command') AS full_command, a(t.attrs,'skill_name') AS skill_name,
  a(t.attrs,'subagent_type') AS subagent_type, n(t.attrs,'result_tokens') AS result_tokens,
  b.span_id AS wait_span_id, b.duration_ms AS wait_ms, a(b.attrs,'decision') AS decision, a(b.attrs,'source') AS decision_source,
  x.span_id AS exec_span_id, x.duration_ms AS exec_ms, a(x.attrs,'success') AS success, a(x.attrs,'error_class') AS error_class,
  a(t.attrs,'vcs.repository.name') AS repo
FROM spans t
LEFT JOIN spans b ON b.parent_span_id=t.span_id AND b.trace_id=t.trace_id AND b.name='claude_code.tool.blocked_on_user'
LEFT JOIN spans x ON x.parent_span_id=t.span_id AND x.trace_id=t.trace_id AND x.name='claude_code.tool.execution'
WHERE t.name='claude_code.tool';

-- query dataset: every span, with api_request attributes merged for llm_request spans
CREATE OR REPLACE VIEW q_spans AS
SELECT s.*, e.attrs AS event_attrs, n(e.attrs,'cost_usd') AS cost_usd
FROM spans s LEFT JOIN events e ON e.name='api_request' AND s.name='claude_code.llm_request'
  AND e.request_id = a(s.attrs,'request_id');
