# Schema notes

> [How the store is laid out, with a figure →](how-it-works/store.md)

What the docs say Claude Code emits, mapped to what Aftertrace needs. Sources, re-read on 2026-10-21:

- Claude Code monitoring: https://code.claude.com/docs/en/monitoring-usage
- Claude API OpenTelemetry: https://platform.claude.com/docs/en/manage-claude/opentelemetry

Every span, attribute, metric and event name below appears in the Claude Code page unless marked **inferred**. The Claude API page covers a different producer (the SDK and the API itself, spans named `anthropic.*`). Aftertrace's MVP does not read it. See the last section.

## Signals and switches

| Signal | Switch | Default |
| - | - | - |
| Metrics | `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_METRICS_EXPORTER=otlp` | delta temporality (`OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE`) |
| Events (OTLP logs) | `OTEL_LOGS_EXPORTER=otlp` | 5 s export interval |
| Traces (beta) | `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`, `OTEL_TRACES_EXPORTER=otlp` | 5 s export interval |
| Hook spans | `ENABLE_BETA_TRACING_DETAILED=1` plus `BETA_TRACING_ENDPOINT`, and org allowlisting for interactive CLI | off |

Claude Code ignores the exporter variables in a repo's `.claude/settings.json`. They must go in `~/.claude/settings.json`, the shell, or managed settings. Managed settings can strip developer-set endpoints, which matters on a work laptop.

## Span tree

```text
claude_code.interaction                      one per user prompt, root of a trace
├── claude_code.llm_request                  one per API request, retries included
├── claude_code.hook                         detailed beta tracing only
└── claude_code.tool
    ├── claude_code.tool.blocked_on_user     permission wait
    ├── claude_code.tool.execution           tool body
    └── (Agent tool) subagent llm_request / tool spans, as siblings of tool.execution
```

Every span carries the standard attributes and `span.type`. `llm_request`, `tool.execution` and `hook` set status `ERROR` on failure. The others always end `UNSET`.

## Attributes Aftertrace uses

**`claude_code.interaction`**: `interaction.sequence`, `interaction.duration_ms`, `user_prompt_length`, `parent.source` (v2.1.268). `user_prompt` is `<REDACTED>` unless `OTEL_LOG_USER_PROMPTS=1`.

**`claude_code.llm_request`**: `model`, `effort` (v2.1.274), `speed`, `query_source_safe` (v2.1.268), `agent_id`, `parent_agent_id`, `llm_request.context`, `duration_ms` (includes retries), `ttft_ms`, `first_content_ms` (v2.1.268), `input_tokens` (excludes cache), `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `request_id`, `client_request_id`, `attempt`, `success`, `status_code`, `error`, `error_class` (v2.1.268), `stop_reason`, `response.has_tool_call`. Span event `gen_ai.request.attempt` with `attempt` and `client_request_id`, one per attempt.

There is no cost and no skill, plugin or MCP attribution on this span. Those live on the `api_request` event. Aftertrace joins them on `request_id`.

**`claude_code.tool`**: `tool_name`, `tool_name_safe` (v2.1.268), `tool_use_id`, `duration_ms` (wait plus execution), `result_tokens`, `agent_id`, `parent_agent_id`, `bash_command_class` and `bash_argv0` (v2.1.268). Gated by `OTEL_LOG_TOOL_DETAILS`: `file_path`, `full_command`, `skill_name`, `subagent_type`.

**`claude_code.tool.blocked_on_user`**: `duration_ms`, `decision` (`accept`, `reject`, `cancelled`), `source` (`config`, `hook`, `user_temporary`, `user_abort`, ...).

**`claude_code.tool.execution`**: `duration_ms`, `tool_use_id`, `success`, `error`, `error_class` (v2.1.268).

**`claude_code.hook`**: `hook_event`, `hook_name`, `num_hooks`, `duration_ms`, `num_success`, `num_blocking`, `num_non_blocking_error`, `num_cancelled`.

## Events Aftertrace uses

All events carry the standard attributes plus `event.name`, `event.timestamp`, `event.sequence`, and `prompt.id`. A record emitted while an interaction is active carries that interaction span's trace and span IDs.

| Event | Fields used | Join key |
| - | - | - |
| `claude_code.user_prompt` | `prompt_length`, `command_name`, `command_source` | `prompt.id`, trace ID |
| `claude_code.api_request` | `cost_usd`, `cost_usd_micros`, tokens, `query_source`, `effort`, `agent.name`, `skill.name`, `plugin.name`, `mcp_server.name`, `mcp_tool.name` | `request_id` to `llm_request` |
| `claude_code.api_error` | `error`, `status_code`, `attempt`, `client_request_id` | `client_request_id` (no `request_id` on timeouts) |
| `claude_code.api_retries_exhausted` | `total_attempts`, `total_retry_duration_ms`, `status_code` | trace ID, `session.id` |
| `claude_code.api_refusal` | `server_fallback_hop`, `has_category` | `request_id` |
| `claude_code.tool_decision` | `decision`, `source`, `tool_source`, `permission_mode` and `classifier_verdict` (v2.1.301), `tool_parameters` (gated) | `tool_use_id` |
| `claude_code.tool_result` | `success`, `duration_ms`, `error_type`, `decision_source`, `tool_result_size_bytes`, `mcp_server_scope`, `tool_parameters` (gated) | `tool_use_id` |
| `claude_code.skill_activated` | `skill.name`, `invocation_trigger`, `skill.source`, `plugin.name` | `prompt.id` |
| `claude_code.subagent_completed` | `agent_type`, `total_tool_uses`, `duration_ms`, `total_tokens` (final request only), `model`, `final_model`, `model_swapped` | none direct, see open questions |
| `claude_code.compaction` | `trigger`, `success`, `duration_ms`, `pre_tokens`, `post_tokens`, `precompute_reuse` | `session.id`, trace ID |
| `claude_code.hook_execution_start` / `_complete` | `hook_event`, `hook_name`, `num_hooks`, `num_blocking`, `total_duration_ms`, output char counts (v2.1.280) | trace ID |
| `claude_code.hook_registered` | `hook_event`, `hook_type`, `hook_source` | `session.id` |
| `claude_code.plugin_loaded` | `plugin.name`, `skill_path_count`, `agent_path_count`, `has_mcp`, `has_hooks` | `session.id` |
| `claude_code.mcp_server_connection` | `status`, `transport_type`, `server_scope`, `duration_ms`, `error_code`, `server_name` (gated) | `session.id` |
| `claude_code.permission_mode_changed` | `from_mode`, `to_mode`, `trigger` | `session.id` |
| `claude_code.assistant_response` | `response_length`, `model`, `query_source` | `request_id` |

Not used in the MVP: `auth`, `internal_error`, `plugin_installed`, `at_mention`, `hook_plugin_metrics`, `feedback_survey`, `retention_sweep`, `managed_settings_resolved`, `api_request_body`, `api_response_body`.

## Metrics

`claude_code.session.count` (`start_type`), `claude_code.cost.usage` (USD), `claude_code.token.usage` (`type`: `input`, `output`, `cacheRead`, `cacheCreation`), `claude_code.active_time.total` (`type`: `user`, `cli`), `claude_code.lines_of_code.count`, `claude_code.commit.count`, `claude_code.pull_request.count`, `claude_code.code_edit_tool.decision`. Cost and token counters carry `model`, `query_source` (`main`, `subagent`, `auxiliary`), `effort`, `agent.name`, `skill.name`, `plugin.name`, `mcp_server.name`, `mcp_tool.name`.

Aftertrace uses metrics only when traces and events are missing (metrics-only users) and for `active_time.total` and lines of code. Spans plus `api_request` events give the same cost at request grain.

## Rule to signal map

| Rule | Signals |
| - | - |
| Allow rule candidate | `blocked_on_user.decision/source` + parent `tool.tool_name`, `bash_argv0`, `full_command`; `tool_decision.source` |
| Retry waste | `llm_request.attempt`, `gen_ai.request.attempt` span events |
| Retries exhausted | `api_retries_exhausted`, `api_error.attempt`, later `api_request` in the same session |
| Cache drop after compaction | `compaction` event, next main-thread `llm_request` cache tokens, `api_request.query_source = compact` |
| Model switch cache rebuild | consecutive main-thread `llm_request.model`, `cache_read_tokens = 0` |
| Expensive skill | `api_request.skill.name`, `cost_usd`, `skill_activated` |
| Plugin skills unused | `plugin_loaded.skill_path_count`, absence of `skill_activated.plugin.name` |
| Repeated tool errors | `tool.execution.success/error_class`, `tool.tool_name`, `full_command` |
| Slow hooks | `hook_execution_complete.total_duration_ms` |
| Large MCP results | `tool.tool_name` (`mcp__` prefix, inferred), `result_tokens`, `api_request.mcp_server.name` |

## Version gates that matter

| Version | What it adds |
| - | - |
| v2.1.268 | `query_source_safe`, `first_content_ms`, `error_class`, `tool_name_safe`, `bash_command_class`, `bash_argv0`, `parent.source` |
| v2.1.269 | `vcs.*` repo attributes (needs `OTEL_METRICS_INCLUDE_REPOSITORY=true`) |
| v2.1.273 | real skill, agent, plugin and MCP names on `api_request` and the cost and token counters (with `OTEL_LOG_TOOL_DETAILS=1`) |
| v2.1.274 | `effort` |
| v2.1.280 | hook output char counts |
| v2.1.301 | `permission_mode`, `classifier_verdict` on `tool_decision` |

Aftertrace should read `app.version` (or `service.version`) and grey out any rule whose inputs need a newer version, instead of reporting a false "never happens".

## Open questions to settle with real data

1. **Event name location.** The docs give "Event Name: `claude_code.api_request`" and an `event.name` attribute of `api_request`. The prototype assumes the full name is the log record body (**inferred**) and reads `event.name` first.
2. **Resource or record attributes.** Are `session.id` and the other standard attributes on the resource, the record, or both? The prototype merges both.
3. **`tool_name` for MCP tools on spans.** Events use the literal `mcp_tool` for user-configured servers. The span's `tool_name` is "Tool name", and `tool_name_safe` exists to hide user-chosen names, which suggests the span carries `mcp__server__tool` (**inferred**).
4. **Joining `subagent_completed` to its Agent tool span.** No `tool_use_id` or `agent_id` on the event. Candidates: `prompt.id` plus `agent_type` plus end time, or the `agent_id` on child spans.
5. **Retry timing.** Does each `gen_ai.request.attempt` span event fire at attempt start? The prototype treats time before the last attempt event as retry waste (**inferred**). Check whether a single-attempt request also emits one event.
6. **Events and trace IDs in interactive sessions.** The docs say records emitted during an interaction carry the interaction's IDs. Confirm this holds without `TRACEPARENT`, and for records emitted from subagents.
7. **`query_source` values.** `compact` is documented on events. Confirm what compaction requests look like on spans (`query_source_safe`).
8. **Duplicate deliveries.** The API page says spans can arrive more than once. Aftertrace dedupes on trace ID plus span ID. Check whether Claude Code's exporter can duplicate log records too, since they have no unique ID (dedupe key candidate: `session.id` plus `event.sequence` plus `event.timestamp`).
9. **Skill inventory.** No event lists installed skills, only `plugin_loaded.skill_path_count`. "Skill never activates" can only work per plugin, or with an opt-in local scan of `~/.claude/skills`.
10. **Volume.** Measure a week of Rahul's traces: spans per turn, file size, ingest time.

## Claude API and Managed Agents traces (later)

The API page documents a separate producer: SDK client spans and API server spans such as `anthropic.messages.create`, `anthropic.model_request`, `anthropic.messages.tool_runner`, `anthropic.custom_tool_use`, `anthropic.session.turn`, `anthropic.compaction` and `anthropic.session.outcome_evaluation`, grouped by `gen_ai.conversation.id` and `anthropic.session.id`. Their usage attributes (`gen_ai.usage.input_tokens`) already include cache tokens, unlike Claude Code's `input_tokens`. Mixing the two needs a per-producer token rule. Claude Code requests to the Anthropic API carry a `traceparent` and record the API's `traceresponse` as a span link, so a later Aftertrace could stitch server spans under `claude_code.llm_request`.
