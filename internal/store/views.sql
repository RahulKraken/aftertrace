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

-- one row per tool call: tool span + permission wait + execution + tool_use_id.
-- Claude Code does not put tool_use_id on the tool span. The tool_decision event
-- carries it, linked by span context to the blocked_on_user child. The wait span's
-- decision and source read "unknown" in non-interactive runs, so fall back to the event.
CREATE OR REPLACE VIEW tools AS
SELECT t.trace_id, t.span_id, t.session_id, t.start_ns, t.end_ns, t.duration_ms,
  a(t.attrs,'tool_name') AS tool_name, coalesce(a(t.attrs,'tool_use_id'), d.tool_use_id) AS tool_use_id, a(t.attrs,'agent_id') AS agent_id,
  a(t.attrs,'bash_argv0') AS bash_argv0, a(t.attrs,'bash_command_class') AS bash_command_class,
  a(t.attrs,'full_command') AS full_command, a(t.attrs,'skill_name') AS skill_name,
  a(t.attrs,'subagent_type') AS subagent_type, n(t.attrs,'result_tokens') AS result_tokens,
  b.span_id AS wait_span_id, b.duration_ms AS wait_ms,
  CASE WHEN coalesce(a(b.attrs,'decision'),'unknown')='unknown' THEN coalesce(a(d.attrs,'decision'), a(b.attrs,'decision')) ELSE a(b.attrs,'decision') END AS decision,
  CASE WHEN coalesce(a(b.attrs,'source'),'unknown')='unknown' THEN coalesce(a(d.attrs,'source'), a(b.attrs,'source')) ELSE a(b.attrs,'source') END AS decision_source,
  x.span_id AS exec_span_id, x.duration_ms AS exec_ms, a(x.attrs,'success') AS success, a(x.attrs,'error_class') AS error_class,
  a(t.attrs,'vcs.repository.name') AS repo
FROM spans t
LEFT JOIN spans b ON b.parent_span_id=t.span_id AND b.trace_id=t.trace_id AND b.name='claude_code.tool.blocked_on_user'
LEFT JOIN spans x ON x.parent_span_id=t.span_id AND x.trace_id=t.trace_id AND x.name='claude_code.tool.execution'
LEFT JOIN events d ON d.name='tool_decision' AND (
  (d.trace_id=t.trace_id AND d.span_id=b.span_id) OR d.tool_use_id=a(t.attrs,'tool_use_id'))
WHERE t.name='claude_code.tool';

-- query dataset: every span, with api_request attributes merged for llm_request spans
CREATE OR REPLACE VIEW q_spans AS
SELECT s.*, e.attrs AS event_attrs, n(e.attrs,'cost_usd') AS cost_usd
FROM spans s LEFT JOIN events e ON e.name='api_request' AND s.name='claude_code.llm_request'
  AND e.request_id = a(s.attrs,'request_id');

-- one row per turn. A running turn has no claude_code.interaction span yet
-- (Claude Code exports it when the turn ends). Its root is the missing parent
-- that most spans point at; children of a still-running tool point at another
-- missing parent for a while.
CREATE OR REPLACE VIEW turn_roots AS
SELECT trace_id, span_id, session_id, start_ns, end_ns, duration_ms, attrs, false AS in_progress
FROM spans WHERE name='claude_code.interaction'
UNION ALL
SELECT o.trace_id, arg_max(o.parent_id, o.n), any_value(o.session_id), t.st, t.en, (t.en - t.st) / 1e6, NULL::JSON, true
FROM (
  SELECT s.trace_id, s.parent_span_id AS parent_id, count(*) AS n, any_value(s.session_id) AS session_id
  FROM spans s
  WHERE coalesce(s.parent_span_id, '') <> '' AND s.name LIKE 'claude_code.%'
    AND NOT EXISTS (SELECT 1 FROM spans i WHERE i.trace_id = s.trace_id AND i.name = 'claude_code.interaction')
    AND NOT EXISTS (SELECT 1 FROM spans p WHERE p.trace_id = s.trace_id AND p.span_id = s.parent_span_id)
  GROUP BY 1, 2
) o
JOIN (SELECT trace_id, min(start_ns) AS st, max(end_ns) AS en FROM spans GROUP BY 1) t USING (trace_id)
GROUP BY o.trace_id, t.st, t.en;

-- model id -> price key: lowercase, drop "vendor/" and "us.anthropic."-style prefixes.
CREATE OR REPLACE MACRO model_key(m) AS regexp_replace(regexp_replace(lower(m), '^.*/', ''), '^([a-z]+\.)+', '');

-- one row per model call from anything that is not Claude Code: your apps and
-- agents sending OpenTelemetry GenAI spans (current and deprecated semconv),
-- the Claude SDK, OpenLLMetry, OpenInference, the Vercel AI SDK, Pydantic AI,
-- Gemini CLI. Agent and tool spans are not calls; their usage is aggregated
-- from the calls inside them. The Claude SDK's CLIENT span is skipped when the
-- API's SERVER span for the same request is present (same name, child of it).
CREATE OR REPLACE VIEW calls AS
WITH base AS (
  SELECT s.trace_id, s.span_id, s.parent_span_id, s.name, s.start_ns, s.end_ns, s.duration_ms, s.is_error, s.status_message,
    coalesce(json_extract_string(s.resource, '$."service.name"'), 'unknown') AS service,
    coalesce(a(s.attrs,'gen_ai.operation.name'), a(s.attrs,'llm.request.type'), lower(a(s.attrs,'openinference.span.kind'))) AS op,
    coalesce(a(s.attrs,'gen_ai.provider.name'), a(s.attrs,'gen_ai.system'), a(s.attrs,'llm.provider'), a(s.attrs,'llm.system'), a(s.attrs,'ai.model.provider')) AS provider,
    coalesce(a(s.attrs,'gen_ai.response.model'), a(s.attrs,'gen_ai.request.model'), a(s.attrs,'llm.model_name'), a(s.attrs,'ai.response.model'), a(s.attrs,'ai.model.id'), a(s.attrs,'model')) AS model,
    coalesce(n(s.attrs,'gen_ai.usage.input_tokens'), n(s.attrs,'gen_ai.usage.prompt_tokens'), n(s.attrs,'llm.token_count.prompt'), n(s.attrs,'ai.usage.inputTokens'), n(s.attrs,'ai.usage.promptTokens'), n(s.attrs,'input_token_count')) AS input_tokens,
    coalesce(n(s.attrs,'gen_ai.usage.output_tokens'), n(s.attrs,'gen_ai.usage.completion_tokens'), n(s.attrs,'llm.token_count.completion'), n(s.attrs,'ai.usage.outputTokens'), n(s.attrs,'ai.usage.completionTokens'), n(s.attrs,'output_token_count')) AS output_tokens,
    coalesce(n(s.attrs,'gen_ai.usage.cache_read.input_tokens'), n(s.attrs,'gen_ai.usage.cache_read_input_tokens'), n(s.attrs,'llm.token_count.prompt_details.cache_read'), n(s.attrs,'ai.usage.inputTokenDetails.cacheReadTokens'), n(s.attrs,'ai.usage.cachedInputTokens')) AS cache_read_tokens,
    coalesce(n(s.attrs,'gen_ai.usage.cache_write.input_tokens'), n(s.attrs,'gen_ai.usage.cache_creation.input_tokens'), n(s.attrs,'gen_ai.usage.cache_creation_input_tokens'), n(s.attrs,'llm.token_count.prompt_details.cache_write'), n(s.attrs,'ai.usage.inputTokenDetails.cacheWriteTokens')) AS cache_write_tokens,
    coalesce(n(s.attrs,'gen_ai.response.time_to_first_chunk') * 1000, n(s.attrs,'ai.response.msToFirstChunk'), n(s.attrs,'ttft_ms')) AS ttft_ms,
    coalesce(n(s.attrs,'llm.cost.total'), n(s.attrs,'operation.cost')) AS reported_cost,
    coalesce(a(s.attrs,'error.type'), CASE WHEN s.is_error THEN 'error' END) AS error_type,
    coalesce(a(s.attrs,'gen_ai.conversation.id'), a(s.attrs,'anthropic.session.id'), a(s.attrs,'session.id'), s.session_id) AS conversation_id,
    a(s.attrs,'ai.telemetry.functionId') AS function_id
  FROM spans s
  WHERE s.name NOT LIKE 'claude_code.%'
    AND coalesce(a(s.attrs,'gen_ai.operation.name'), '') NOT IN ('invoke_agent', 'create_agent', 'invoke_workflow', 'execute_tool', 'plan')
    AND s.name NOT IN ('anthropic.model_request', 'anthropic.messages.tool_runner', 'anthropic.session.turn')
    AND (
      a(s.attrs,'gen_ai.operation.name') IN ('chat', 'text_completion', 'generate_content', 'embeddings')
      OR s.name = 'anthropic.messages.create'
      OR a(s.attrs,'openinference.span.kind') = 'LLM'
      OR s.name IN ('ai.generateText.doGenerate', 'ai.streamText.doStream', 'ai.generateObject.doGenerate', 'ai.streamObject.doStream')
      OR s.name = 'llm_call'
      OR a(s.attrs,'llm.request.type') IN ('chat', 'completion')
      -- Hand-rolled spans: a model and token usage, but no operation name.
      OR (a(s.attrs,'gen_ai.request.model') IS NOT NULL AND (n(s.attrs,'gen_ai.usage.input_tokens') IS NOT NULL OR n(s.attrs,'gen_ai.usage.output_tokens') IS NOT NULL))
    )
    AND NOT (s.name = 'anthropic.messages.create' AND EXISTS (
      SELECT 1 FROM spans k WHERE k.trace_id = s.trace_id AND k.parent_span_id = s.span_id AND k.name = 'anthropic.messages.create'))
),
keyed AS (
  SELECT b.*, model_key(b.model) AS model_key,
    (SELECT r.name FROM spans r WHERE r.trace_id = b.trace_id AND coalesce(r.parent_span_id, '') = '' ORDER BY r.start_ns LIMIT 1) AS root_name
  FROM base b
)
SELECT k.* EXCLUDE (reported_cost, root_name),
  coalesce(k.function_id, CASE WHEN k.root_name IS NULL OR k.root_name = k.name THEN k.name ELSE k.root_name END) AS operation,
  coalesce(k.reported_cost,
    (SELECT (greatest(coalesce(k.input_tokens, 0) - coalesce(k.cache_read_tokens, 0) - coalesce(k.cache_write_tokens, 0), 0) * p.input
            + coalesce(k.cache_write_tokens, 0) * p.cache_write + coalesce(k.cache_read_tokens, 0) * p.cache_read
            + coalesce(k.output_tokens, 0) * p.output) / 1e6
     FROM prices p WHERE starts_with(k.model_key, p.prefix) ORDER BY length(p.prefix) DESC LIMIT 1)) AS cost_usd,
  k.reported_cost IS NOT NULL AS cost_reported
FROM keyed k;
