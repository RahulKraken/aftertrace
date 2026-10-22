# JSON API

Read-only HTTP API served by `aftertrace serve` on `127.0.0.1:7311` (the UI port). Shapes match the throwaway prototype so the web UI can consume them. Attribute names come from Claude Code's monitoring docs; Aftertrace does not invent them.

Ask (`POST /api/ask`) is a stub in this build. It never calls a model and never sends data off the machine.

## Endpoints

| Method | Path | Returns |
| - | - | - |
| GET | `/api/status` | Server info, capture settings, counts for the sidebar |
| GET | `/api/recap?week=N` | The Nth week back: summary, previous week, top tools/models/apps, priciest and longest turns, busiest day in lanes, peak parallel turns |
| GET | `/api/overview` | Home: this week vs last, daily series, live lanes, sources, top finding, recent sessions |
| GET | `/api/sources` | Everything received, grouped by `service.name`, with first and last seen |
| GET | `/api/apps` | Apps (non-Claude-Code services): calls, cost, latency, failures, 14-day series |
| GET | `/api/app/{service}` | One app: summary, operations, models, recent requests, recent errors |
| GET | `/api/sessions` | Session list |
| GET | `/api/session/{session_id}` | Session KPIs plus one row per turn |
| GET | `/api/trace/{trace_id}` | One turn: full span tree, events, breakdown, prev/next |
| GET | `/api/findings` | Findings from `rules/*.sql` |
| GET | `/api/cost?dim=` | Cost (or tool volume) by dimension |
| GET | `/api/fields` | Query-builder field catalog |
| GET | `/api/field-values?field=` | Up to 30 distinct values of one field |
| GET | `/api/range` | `{lo, hi}` span time range in unix ns |
| POST | `/api/query` | Builder JSON compiled to SQL |
| POST | `/api/query/traces` | Matching traces for a builder query |
| POST | `/api/sql` | One read-only `SELECT` or `WITH` |
| GET | `/api/ask/suggestions` | Stub agent metadata |
| POST | `/api/ask` | Stub: `{answer, sql, result, evidence, builder}` |

Errors are `{ "error": "..." }` with HTTP 400.

## Sessions

`GET /api/sessions` — array, newest first.

```json
{
  "session_id": "uuid",
  "start_ns": 0,
  "end_ns": 0,
  "turns": 5,
  "turn_ms": 12345.0,
  "repo": "acme-web",
  "entrypoint": "cli",
  "cost_usd": 1.23,
  "tokens": 40000,
  "cache_hit": 0.81,
  "models": ["claude-sonnet-5"],
  "errors": 0,
  "retried": 1,
  "agents": ["general-purpose"],
  "breakdown": {
    "model": 1000,
    "tool": 800,
    "permission_wait": 200,
    "retry": 50,
    "hook": 0,
    "other": 10
  },
  "findings": 2,
  "title": "Fix the flaky login test",
  "running": false
}
```

`title` is the session's first prompt, cut to 200 characters. It is `null` unless prompt text is captured (`OTEL_LOG_USER_PROMPTS=1` and `aftertrace serve --store-content`). `running` is true while a turn in the session is still in progress (see below).

`breakdown` is wall-clock ms painted per turn (waiting on you, retry waste, model, tool run, hooks, permission checks, other). Overlaps count once. `permission_wait` counts only permission prompts a person decided (`user_*` decision sources, or unknown); prompts that config, a hook or auto mode decided are `permission_check`.

`GET /api/session/{id}` — `{ "session": <list row>, "turns": [ ... ] }`. Each turn:

```json
{
  "trace_id": "hex",
  "span_id": "hex",
  "start_ns": 0,
  "duration_ms": 1000,
  "seq": 1,
  "cost_usd": 0.1,
  "requests": 3,
  "models": ["claude-sonnet-5"],
  "tools": 4,
  "breakdown": { "model": 400, "tool": 300, "permission_wait": 0, "retry": 0, "hook": 0, "other": 10 },
  "prompt": "Fix the flaky login test",
  "in_progress": false,
  "running": false
}
```

`prompt` is the text typed for that turn, or `null` when prompts are not captured.

Claude Code exports `claude_code.interaction` when a turn ends. Until then the turn has `in_progress: true`, its spans point at a parent that has not arrived, and Aftertrace stands in for that root. `running` is `in_progress` with spans in the last 5 minutes; an `in_progress` turn that stopped receiving spans is incomplete (Claude Code exited mid-turn).

## Trace (waterfall)

`GET /api/trace/{trace_id}` — one `claude_code.interaction`.

- `spans` — every span in the trace, ordered by start. `attrs` is the span attribute map. `joined` is the `api_request` event fields (`cost_usd`, `skill.name`, `agent.name`, `mcp_server.name`, `query_source`) when the span is `claude_code.llm_request`. `critical` is the critical-path flag. `retry_end_ns` is the last `gen_ai.request.attempt` event time when `attempt > 1` (inferred: time before it is retry waste). `findings` is an array of finding indexes into `GET /api/findings`.
- `span_events` — `{span_id, name, time_ns, attrs}`
- `events` — log records on this trace `{name, ts_ns, tool_use_id, request_id, attrs}`
- `breakdown`, `prev`, `next`, `turn_index`, `turn_count`, `session_id`
- `in_progress` — the turn has not ended. `spans[0]` is a stand-in `claude_code.interaction` with `attrs["aftertrace.in_progress"] = true`, spanning the spans received so far.

With content captured, prompt and response text is in `events` (`user_prompt.prompt`, `assistant_response.response`, `tool_result.tool_input`) and tool output is in `span_events` (`tool.output` with `output`).

Join keys used throughout: `session.id`, `prompt.id`, `request_id`, `tool_use_id`, `trace_id`, `span_id`.

## Findings

`GET /api/findings` — array, severity then impact.

```json
{
  "id": 0,
  "rule_id": "retry.waste",
  "rule_title": "Time lost to API retries",
  "pillar": "bottleneck",
  "severity": "medium",
  "headline": "3 API requests needed retries",
  "impact_value": 12.5,
  "impact_unit": "s lost to retries",
  "detail": "...",
  "recommendation": "...",
  "evidence": [{"trace_id": "...", "span_id": "...", "label": "×3 attempts, 4.1s lost"}],
  "sessions": ["uuid"]
}
```

Rules are SQL files in `rules/` (also embedded from `internal/rules/files/`). Header:

```
-- @id retry.waste
-- @title Time lost to API retries
-- @pillar bottleneck
-- @min_version 2.1.0
```

The query must return `severity`, `headline`, `impact_value`, `impact_unit`, `detail`, `recommendation`, `evidence` (JSON array of `{trace_id, span_id, label}`), `sessions` (JSON array of session ids). A failing rule becomes an `error` finding and does not block the others.

## Cost

`GET /api/cost?dim=model` — `dim` is `source`, `model`, `effort`, `skill`, `subagent`, `mcp`, `repo`, `query_source`, or `tool`. `source` puts Claude Code next to each app (from the `calls` view, with input tokens normalised to exclude cache, as Claude Code reports them).

For cost dimensions: columns `dim, cost_usd, share, requests, input, output, cache_read, cache_write, cache_hit`. Cost is `api_request.cost_usd` joined to `llm_request` on `request_id`.

For `tool`: columns `tool_name, calls, result_tokens, exec_s, wait_s`. Tools have no cost of their own.

## Query builder

`POST /api/query`

```json
{
  "agg": "P95",
  "field": "duration_ms",
  "where": [{"field": "name", "op": "=", "value": "claude_code.llm_request"}],
  "group_by": ["model"],
  "order": "desc",
  "limit": 20,
  "from_ns": 0,
  "to_ns": 0
}
```

`agg`: `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, `P50`, `P95`, `P99`. Ops: `=`, `!=`, `>`, `<`, `>=`, `<=`, `contains`, `exists`, `not exists`. At most two `group_by` keys. Dataset is the `q_spans` view (every span, with `api_request` attributes merged onto `llm_request` rows).

Response: `{sql, params, table: [{groups, value, n}], series: [{groups, points: [[bucket_ns, value], ...]}], step_ns, lo, hi}`.

`POST /api/query/traces` body `{query, group_values, bucket}` lists up to 50 matching traces `{trace_id, span_id, matches, max_ms, session_id, start_ns, turn_ms, repo}`.

`GET /api/fields` — `[{key, kind}]` with `kind` `num` or `str`.

`GET /api/field-values?field=model` — sorted array of up to 30 distinct non-empty values of `field` in `q_spans`, as strings. Feeds the builder's value picker. `field` must be a key from `GET /api/fields` (default `name`); anything else is a 400.

## Raw SQL

`POST /api/sql` body `{ "sql": "SELECT ..." }`. One `SELECT` or `WITH` that DuckDB parses as a query. Limit 500 rows. Response `{columns, rows}`.

The query cannot touch anything outside the tables and views:

- The DuckDB instance is opened with `enable_external_access=false` and `lock_configuration=true`. `read_text`, `read_csv`, `FROM 'file'`, `glob`, `COPY`, `ATTACH`, `INSTALL`, and `LOAD` fail, and no `SET` can turn access back on.
- A regex refuses anything that does not start with `SELECT` or `WITH`, or has a second statement.
- DuckDB prepares the statement first; anything but a `SELECT` (for example `WITH ... DELETE`) is refused.
- It runs in a transaction that is always rolled back.

## Ask (stub)

`GET /api/ask/suggestions` — `{agent, questions, schema}`. `questions` is empty in this build.

`POST /api/ask` body `{question}` returns `{answer, sql: null, result: null, evidence: [], builder: null}` explaining that Ask is opt-in and not wired yet.

## Overview

`GET /api/overview` powers the Home page.

- `lo`, `hi`: the week, unix ns. The last 7 days, or the 7 days ending at the newest data when nothing arrived recently (`anchored: true`).
- `week`, `prev`: this week and the one before. `sessions`, `turns`, `turn_ms`, `breakdown`, `cost_usd`, `requests`, `tokens`, `cache_hit`, `lines_added`, `lines_removed`, `commits`, `pull_requests`, `active_s` (from Claude Code metrics), `tool_calls`, `approvals` (prompts a person approved), `errors`.
- `days`: 14 local days ending at `hi`, each `{day, start_ns, cost_usd, turn_ms, wait_ms, turns}`.
- `live`: turns in progress that received spans in the last 5 minutes, each `{session_id, trace_id, title, source, start_ns, last_ns, spans, cost_usd, doing, quiet}`. `doing` is the latest tool or model call; `quiet` means nothing new for 90 seconds.
- `sources`: as `GET /api/sources`.
- `top`, `open`: the highest-ranked finding and the number of findings.
- `recent`: the six newest sessions, shaped like `GET /api/sessions` rows.

`GET /api/sources` lists every `service.name` seen in spans, events or metrics: `{name, kind, spans, events, metrics, first_ns, last_ns, live}`. `kind` is `claude-code` for any `claude-code*` service and `app` otherwise. `live` means data in the last 5 minutes.

## Status

`GET /api/status` is cheap enough to poll; the UI calls it every 5 seconds.

```json
{
  "info": { "version": "v0.1.0", "db_path": "/Users/you/.aftertrace/aftertrace.duckdb", "store_content": false,
            "otlp_grpc": "127.0.0.1:4317", "otlp_http": "127.0.0.1:4318", "ui": "127.0.0.1:7311",
            "service": "" },
  "ask": { "enabled": false },
  "counts": { "Spans": 1206, "SpanEvents": 30, "Events": 1770, "MetricPoints": 382 },
  "running": 1, "sessions": 3, "findings": 4, "apps": 0, "sources": 1, "last_ns": 1792628786886000000
}
```

`info.service` is `launchd` or `systemd` when the server was started by [`aftertrace service install`](cli.md#aftertrace-service), and empty otherwise. Connect uses it to suggest the service.

Findings are cached for 10 seconds, so `findings` can lag a new rule match by that long.

## Apps

`GET /api/apps` returns one row per `service.name` that is not `claude-code*`: `{service, spans, traces, calls, failed, cost_usd, input_tokens, output_tokens, cache_read_tokens, p50_ms, p95_ms, ttft_p50_ms, models, operations, first_ns, last_ns, live, daily_cost, daily_calls}`. Call numbers come from the `calls` view ([apps.md](apps.md)); a service with spans but no recognised model calls has `calls: 0`.

`GET /api/app/{service}` returns `{app, operations, models, recent, errors}`. `operations` and `models` rows are `{key, calls, failed, cost_usd, p50_ms, p95_ms, ttft_p50_ms, avg_input_tokens, avg_output_tokens, models, cost_estimated}`. `recent` is the 40 newest traces with their calls rolled up; `errors` the 10 newest failed spans.

In `GET /api/trace/{id}`, model calls from apps carry `joined: {cost_usd, model, provider, cost_estimated, app_call: true}`, and the trace has `service`.

## Recap

`GET /api/recap?week=N` (N from 0, the current week, to 52). The week is the 7 days ending now, or ending at the newest data when nothing arrived in the last week, minus N weeks.

`{week, lo, hi, has_older, stats, prev, tools, models, apps, priciest, longest, busiest_day, peak_parallel}`. `stats` and `prev` are shaped like `week` in `/api/overview`. `busiest_day` is `{day, turn_ms, lanes: [{session_id, title, turns: [[start_ns, end_ns], ...]}]}`. `priciest` and `longest` are turns `{trace_id, session_id, start_ns, duration_ms, cost_usd, prompt?}`; `prompt` only when prompt text is captured.
