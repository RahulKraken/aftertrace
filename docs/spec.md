# Aftertrace product spec

Draft 1, 2026-10-21. Schema details and open questions live in `schema-notes.md`. Stack options live in `stack.md`.

## Positioning

Aftertrace is a local profiler and advisor for Claude Code. It receives Claude Code's OpenTelemetry metrics, events and traces on your machine, stores them in DuckDB, and shows where each session spent its time and money. A rules engine turns patterns into findings, and every finding links to the spans behind it. You can query the data with a visual builder or ask a question in plain English. The Ask agent writes and runs read-only SQL against your local store and shows its query and evidence. Data stays on your machine. The Ask agent is opt-in, and it sends only the schema and aggregated results to the model you choose.

## User and jobs

The user is a developer who runs Claude Code daily on their own machine, often with skills, subagents, MCP servers and hooks. Later, a team lead running Aftertrace behind a shared collector.

| Job | What Aftertrace shows |
| - | - |
| Why was that turn slow? | Waterfall with wall clock split into model, tool run, waiting on you, retry waste and hooks |
| Where does my money go? | Cost by skill, subagent, MCP server, tool, model, effort and repo, with cache hit rate |
| What should I change? | Findings ranked by time or dollars, each with a concrete setting or habit change |
| Did my change help? | Query any metric over time, before and after |
| Answer an ad hoc question fast | Ask in English, get numbers, the SQL, and evidence traces |

## Views

All views share one top bar: Sessions, Findings, Query, Cost. Rows are dense (24 to 30 px), numbers are monospace and right-aligned, and colour carries one meaning at a time. Amber means waiting on you. Rose means retry waste or error. Everything else is neutral.

**Sessions.** One row per `session.id`: start time, repo, agent flow (`main ▸ general-purpose ▸ code-reviewer`), turns, time in turns, a stacked "where time went" bar, cost, cache hit rate, models, retried requests, finding count. Column headers carry an aggregate (sum or p50). Facets on the left (later): repo, model, effort, permission mode, skill, subagent, MCP server, entrypoint. Click a row to open the session.

**Session.** KPI strip (turns, time, cost, tokens, cache hit, waiting on you), then one row per turn (`claude_code.interaction`) with its own split bar. Click a turn to open its waterfall.

**Waterfall.** The centrepiece. One trace is one turn.
- 24 px rows. Label column (about 38%) holds tree guides, a caret with hidden-descendant count, a type glyph (turn, model, tool, subagent, wait, run, hook), the name, a muted target (`Bash · npm test`, `Read · src/app.ts`), and two right-aligned metrics: duration, then cost for model rows or result tokens for tool rows.
- Bars sit on a shared time axis with a sticky ruler. Compaction events show as vertical markers.
- Model bars split into phases: retry waste (rose, hatched), time to first token (light), streaming (solid).
- Tool bars split into "blocked on you" (amber, hatched) and run. The label reads `blocked 22.5s · run 18.1s`.
- The critical path draws in full colour. Everything else fades to about 45%. Permission waits never fade.
- Errors get a rose left border and bar outline, never a filled red bar. Retried requests show `×N` from `attempt`.
- Default expansion: model and tool rows visible, tool children (wait and run) collapsed into the tool bar's phases, subagent subtrees collapsible with a rollup (`21 spans · $0.19`).
- Header chips: `⏸ 22.5s waiting on you (23%)`, model, tool run, retry waste, hooks, compaction `491k→14k`. Prev and next turn buttons.
- Keyboard: ↑ ↓ move selection, ← → collapse and expand, `[` `]` previous and next turn.
- Detail pane, docked right at 420 px, metrics first: header with parent link, phase bar, metrics (tokens, cost, model, effort, attempt, skill, agent, MCP server, cache hit), child mix for turns, findings citing this span with impact, joined events (by `tool_use_id` or `request_id`), searchable attributes, raw span. Opening the pane never reflows the tree. A muted line says prompt and response text are redacted at the source.
- Later: minimap strip, idle-gap folding, self-time and cost lenses, auto-grouping of repeated siblings (`Read ×30`), whole-session waterfall.

**Findings.** Grouped by severity with a count. Each finding is one line with its quantified impact on the right (`1m 6s waited`, `$6.58`), a detail line, the recommendation, and evidence chips. Each chip opens the waterfall with that span selected and its ancestors expanded. Rule ID and pillar in muted text. Later: dismiss, snooze, "new since last week", and a settings diff the user can copy.

**Query.** One view, three tabs over the same store.
- *Builder.* VISUALIZE (COUNT, SUM, AVG, MIN, MAX, P50, P95, P99, HEATMAP) over a numeric field such as `duration_ms`, `ttft_ms`, `cost_usd`, `input_tokens`, `cache_read_tokens`, `result_tokens`. WHERE clauses on any span attribute or joined event attribute (`=`, `!=`, `>`, `<`, `contains`, `exists`). GROUP BY up to two attributes such as `skill.name`, `model`, `effort`, `tool_name`, `repo`. ORDER BY, LIMIT, and a time range. Results: a line chart (one series per top group, or a heatmap for HEATMAP) above a grouped table. Click a chart point, heatmap cell or table row to list the matching traces. Each trace opens the waterfall on the matching span. The compiled SQL is one click away.
- *Ask.* A question box with suggested questions. The answer shows the numbers in a sentence, the SQL it ran, the result table, and evidence traces that open the waterfall. "Edit as SQL" and "Open in builder" carry the query over.
- *SQL.* Raw read-only SQL with the schema in a side panel. Any `trace_id` column links to the waterfall.

**Cost.** A dimension switch (model, effort, skill, subagent, MCP server, tool, repo, query source) over one table: cost, share, requests, input, output, cache read, cache write, cache hit. Tools have no cost of their own, so the tool view shows calls, result tokens, run time and wait time. Later: spend over time split by the chosen dimension, and a per-request ledger that deep-links to spans.

**First run.** An empty state with three live checks: receiver listening, `~/.claude/settings.json` env set, first span received. Each check turns green as data arrives.

## Ask agent

- **Contract.** `answer(question) -> {answer, sql, result, evidence, builder?}`. One tool: `run_sql(sql)`, a read-only DuckDB executor. The agent gets an explicit schema (tables, views, macros, documented attribute names) in its system prompt. It may run several queries per question, capped (proposed: 6 queries, 500 rows each).
- **Read-only by construction.** The DuckDB instance runs with external access disabled and configuration locked (a second `read_only` instance on the same file is refused by DuckDB). Only one statement per call, which DuckDB must parse as a `SELECT`, run in a rolled-back transaction. No file, network or extension access.
- **Evidence.** The agent must return at least one query whose result has `trace_id` and `span_id` columns when the question concerns specific turns. The UI turns those into waterfall links. An answer without numbers from a query is rejected and retried once.
- **Off by default.** Aftertrace works fully without it. Turning it on shows exactly what will be sent.
- **What leaves the machine.** The schema, the question, and the results of the agent's own queries. Results are aggregates or IDs plus the documented metadata (model, durations, token counts, tool names, file paths and commands if the user enabled `OTEL_LOG_TOOL_DETAILS`). Prompt text, responses and tool content never reach the store, so they cannot reach the model. A setting strips `full_command`, `file_path` and `tool_parameters` from results before they are sent.
- **Model choice.** Default: the user's own Anthropic API key (`ANTHROPIC_API_KEY`) or existing Claude auth if a supported path exists. Option: a local model through an OpenAI-compatible endpoint (Ollama, llama.cpp, LM Studio), which keeps everything on the machine. Aftertrace never ships or proxies a key.
- **Audit.** Every question, every SQL statement, and the byte count sent are kept in a local log the user can read and clear.
- **Prototype.** A canned agent behind the same interface answers four suggested questions with real SQL and makes no network calls, even when a key is present.

## Rules engine

Each rule is one file: an ID, a pillar (bottleneck, cost, config), one or more SQL queries over the store, and a template that turns rows into findings. Every finding states an impact in seconds or dollars and lists evidence as `(trace_id, span_id, label)`. Rules declare the minimum Claude Code version and the env gates they need. Aftertrace skips a rule whose inputs are missing and says why. A failing rule shows an error finding and never blocks the others. Thresholds live in a user config.

### Rules catalog

MVP marks the rules the prototype implements (10). Field names are from the docs.

| ID | Trigger | Evidence | Recommendation | False-positive risk |
| - | - | - | - | - |
| `permission.allow_rule_candidate` (MVP) | ≥3 `claude_code.tool.blocked_on_user` with `decision = accept` and `source` in (`user_temporary`, `user_permanent`) for the same pattern. Pattern: `Bash(<first two words of full_command>:*)`, else `Bash(<bash_argv0>:*)`, else `tool_name` | The wait spans | Add the pattern to `permissions.allow` in `~/.claude/settings.json` | A command that should stay gated (`git push`, `rm`). Never suggest for `bash_command_class` in a risky set. Without `OTEL_LOG_TOOL_DETAILS`, patterns are coarse (`Bash(npm:*)`) |
| `retry.waste` (MVP) | `llm_request.attempt > 1` and success | The request spans. Waste is span start to last `gen_ai.request.attempt` | Usually server-side. Check status, consider a fallback model for long runs, check a proxy if errors cluster on one network | Attempt event timing is inferred |
| `retry.exhausted` (MVP) | `api_retries_exhausted` event | Failed `llm_request` span (status `ERROR`) | Re-run. Raise `CLAUDE_CODE_MAX_RETRIES` or set `CLAUDE_CODE_RETRY_WATCHDOG` for unattended runs | `attempt` restarts after a streaming failure, so counts can understate |
| `cache.drop_after_compaction` (MVP) | Successful `compaction`, then the next main-thread request's cache hit rate (`cache_read_tokens / (cache_read_tokens + cache_creation_tokens + input_tokens)`) is ≥30 points below the mean of the 5 before | Compaction turn, the rewrite request | Start fresh sessions at natural breakpoints, run `/compact` between tasks, push exploration into subagents | Expected once per compaction. Escalate only on frequency (see `compaction.frequent`) |
| `model.switch_cache_rebuild` (MVP) | Consecutive main-thread requests where `model` changes and `cache_read_tokens = 0` | The rebuild request | Pick the model at session start, switch at `/clear`, or delegate the hard step to a subagent | A deliberate switch for a hard task is fine. Low severity |
| `skill.cost` (MVP) | Skill share of `cost_usd` (from `api_request.skill.name`) ≥25%, or ≥$1 per `skill_activated` | Top 5 requests by cost for the skill | Try a lower `effort` or cheaper model for that skill and compare output | Skills that do heavy work by design. Needs v2.1.273 and `OTEL_LOG_TOOL_DETAILS` for real names |
| `plugin.skills_unused` (MVP) | `plugin_loaded.skill_path_count > 0` in ≥3 sessions and no `skill_activated` with that `plugin.name` | Session IDs | Disable the plugin. Each loaded skill adds its description to context (inferred) | Seasonal skills. `plugin.name` is `third-party` without the gate |
| `tool.repeated_errors` (MVP) | ≥2 `tool.execution` with `success = false` and the same `error_class` and target in one session | The execution spans | Fix the environment once and record it in `CLAUDE.md` | Test-driven loops where failures are the point |
| `hook.overhead` (MVP) | Mean `hook_execution_complete.total_duration_ms` ≥1 s per `hook_name` | Turns with the hook | Narrow the matcher, or move slow work to `PostToolUse` | Security hooks that must run. Report, never suggest removal |
| `mcp.large_results` (MVP) | `tool.result_tokens > 10000` on an MCP tool (`tool_name` prefix `mcp__`, inferred) | The tool spans. Impact: `cost_usd` of requests with that `mcp_server.name` and `mcp_tool.name` | Ask for narrower results, or call the server from a subagent | Results the task needed |
| `compaction.frequent` | ≥2 `compaction` with `trigger = auto` in one session, or `precompute_reuse` misses | Compaction turns | Split work into sessions. Delegate exploration | Long sessions by design |
| `permission.reject_loop` | ≥3 `tool_decision` with `decision = reject` for the same pattern | Wait spans | Add a `permissions.deny` rule so the model stops trying | Rejections that were case by case |
| `permission.classifier_blocks` | `tool_decision.classifier_verdict` in (`block`, `no_verdict`, `unavailable`) clustered by tool | Decision events joined by `tool_use_id` | Add an explicit allow or deny rule for the pattern | Needs v2.1.301 |
| `effort.overkill` | Main-thread requests at `effort` `xhigh` or `max` where most have `stop_reason = tool_use` and `output_tokens` below a threshold | The requests | Try `high` for routine tool-calling work | Hard reasoning steps that emit short tool calls. Low severity |
| `ttft.slow` | p95 `ttft_ms` per `model` and `effort` above the user's own baseline by 2× | The slowest requests | Usually load or a large context. Check context size and time of day | Baseline needs a week of data |
| `output.truncated` | `stop_reason = max_tokens` | The requests | Ask for smaller steps, or raise the output limit if configurable | Rare, but a cheap check |
| `subagent.context_bloat` | `subagent_completed.total_tokens` high relative to `total_tool_uses`, or a subagent's requests read large uncached context | The Agent tool span and its subtree | Tighten the subagent prompt and tool list | Join from event to span is inferred |
| `mcp.connection_failed` | `mcp_server_connection.status = failed` repeatedly | Session IDs | Fix or remove the server config. Failed servers cost startup time | Flaky network |
| `read.large_files` | `Read` tool `result_tokens` above a threshold, repeated on the same `file_path` | Tool spans | Read ranges, or add a summary file | Needs the gate for `file_path` |

## Data model

DuckDB, one file under `~/.aftertrace/`. Raw tables keep every attribute as JSON so new Claude Code attributes never need a migration. Typed views do the joins.

| Table | Grain | Key columns |
| - | - | - |
| `spans` | one per span | `trace_id`, `span_id` (primary key, dedupes retried deliveries), `parent_span_id`, `name`, `start_ns`, `end_ns`, `duration_ms`, `is_error`, `session_id`, `attrs` JSON, `resource` JSON |
| `span_events` | one per span event | `trace_id`, `span_id`, `name` (`gen_ai.request.attempt`, `tool.output`), `time_ns`, `attrs` |
| `events` | one per log record | `ts_ns`, `name`, `session_id`, `prompt_id`, `trace_id`, `span_id`, `request_id`, `tool_use_id`, `attrs`, `resource` |
| `metric_points` | one per data point | `name`, `unit`, `ts_ns`, `value`, `session_id`, `attrs` |
| `findings` (later, persisted) | one per finding per run | `rule_id`, `fingerprint`, evidence list, first seen, dismissed |

Views:

- `llm`: `llm_request` span joined to `api_request` on `request_id`. Adds `cost_usd`, `skill.name`, `agent.name`, `mcp_server.name`, `mcp_tool.name`, `query_source`.
- `tools`: `claude_code.tool` span joined to its `blocked_on_user` and `execution` children on `parent_span_id`, and to `tool_decision` and `tool_result` on `tool_use_id`.
- `turns`: `claude_code.interaction` with the painted time split. Events join by trace ID, or by `prompt.id` when trace IDs are absent (metrics and events only).
- `subagents`: Agent tool spans with their subtree (child spans carry `agent_id` and `parent_agent_id`), plus `subagent_completed`.
- `q_spans`: every span with its joined event attributes, the query builder's dataset.

Time split per turn: paint each instant of the interaction with the highest-priority active category (waiting on you, retry waste, model, tool run, hooks, other). Overlaps count once, so parallel tools and subagents don't double count. Hook time comes from `claude_code.hook` spans when present, else from `hook_execution_complete` events.

Critical path per turn: walk back from the root's end, taking the child that ends last before the cursor, recursing into it, and moving the cursor to its start. On a tie, prefer real work over the `tool.execution` wrapper so subagent spans stay on the path.

## Privacy model

- Aftertrace binds to `127.0.0.1` only. No telemetry, no update check, no phone-home. A `--listen` flag is required to accept remote OTLP (team mode).
- Content is redacted at the source by default. Aftertrace recommends `OTEL_LOG_TOOL_DETAILS=1` because without it skill, agent and MCP names collapse to `custom`, and says plainly that it also records Bash commands and file paths. It never recommends `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_TOOL_CONTENT` or `OTEL_LOG_RAW_API_BODIES`.
- If content attributes arrive anyway (`user_prompt`, `prompt`, `prompt_text`, `response`, `tool_input`, `tool.output`, `new_context`, `body`), the receiver drops them before storage unless the user sets `store_content = true`.
- `user.email` and account IDs are dropped at ingest by default.
- The Ask agent is the only path that can send data out. It is off by default, see "Ask agent".
- Retention: a configurable window (default 30 days) and `aftertrace purge`.

## Setup and onboarding

1. `brew install aftertrace` or download one binary. `aftertrace` starts the receiver on `127.0.0.1:4317` (gRPC) and `:4318` (HTTP) and the UI on `127.0.0.1:7311`.
2. `aftertrace init` prints, and with consent merges, the `env` block into `~/.claude/settings.json`: `CLAUDE_CODE_ENABLE_TELEMETRY`, `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA`, the three exporters, protocol, endpoint, `OTEL_LOG_TOOL_DETAILS`, `OTEL_METRICS_INCLUDE_VERSION`, `OTEL_METRICS_INCLUDE_ENTRYPOINT`, `OTEL_METRICS_INCLUDE_REPOSITORY`. It warns when managed settings exist, because they can redirect telemetry to a company collector.
3. The first-run screen confirms the first span.
4. Behind an existing collector: add an `otlp` exporter pointing at Aftertrace, or point `aftertrace import` at the file exporter's JSONL. Same parser either way.

## Out of scope

Prompt or response content analysis. Hosted or multi-tenant service. Alerting and paging. Billing reconciliation (cost is Claude Code's estimate). Editing settings without confirmation. Non-Claude-Code agents. Claude API and Managed Agents traces in v1.

## MVP and later

**MVP.** Local OTLP receiver (gRPC and HTTP) and JSONL import. DuckDB store with dedupe and content dropping. Sessions, session, waterfall with detail pane, findings, cost by dimension, query builder (COUNT, SUM, AVG, percentiles, WHERE, GROUP BY, time range, line chart, table, click-through to traces), raw SQL. The 10 MVP rules. First-run checks. Ask agent behind an opt-in flag with the user's Anthropic key.

**Later.** Heatmap visualisation. Local model for Ask. Remaining rules. Facets on the session list. Minimap, idle folding, lenses, sibling grouping. Findings persistence, dismiss and trends. Before and after comparison for a settings change. Team mode behind a shared collector. Claude API and Managed Agents spans. Community rules registry.

## Decisions for Rahul

1. Name: Aftertrace (renamed from Saight). Domain not chosen yet. The repo `RahulKraken/aftertrace` exists, and PRs target `main`.
2. Stack, see `stack.md`.
3. License: Apache-2.0 (decided 2026-10-22).
4. Whether Ask ships in the MVP or right after.
