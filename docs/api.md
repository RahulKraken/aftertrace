# JSON API

Read-only HTTP API served by `aftertrace serve` on `127.0.0.1:7311` (the UI port). Shapes match the throwaway prototype so the web UI can consume them. Attribute names come from Claude Code's monitoring docs; Aftertrace does not invent them.

Ask (`POST /api/ask`) is a stub in this build. It never calls a model and never sends data off the machine.

## Endpoints

| Method | Path | Returns |
| - | - | - |
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
  "findings": 2
}
```

`breakdown` is wall-clock ms painted per turn (waiting on you, retry waste, model, tool run, hooks, other). Overlaps count once.

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
  "breakdown": { "model": 400, "tool": 300, "permission_wait": 0, "retry": 0, "hook": 0, "other": 10 }
}
```

## Trace (waterfall)

`GET /api/trace/{trace_id}` — one `claude_code.interaction`.

- `spans` — every span in the trace, ordered by start. `attrs` is the span attribute map. `joined` is the `api_request` event fields (`cost_usd`, `skill.name`, `agent.name`, `mcp_server.name`, `query_source`) when the span is `claude_code.llm_request`. `critical` is the critical-path flag. `retry_end_ns` is the last `gen_ai.request.attempt` event time when `attempt > 1` (inferred: time before it is retry waste). `findings` is an array of finding indexes into `GET /api/findings`.
- `span_events` — `{span_id, name, time_ns, attrs}`
- `events` — log records on this trace `{name, ts_ns, tool_use_id, request_id, attrs}`
- `breakdown`, `prev`, `next`, `turn_index`, `turn_count`, `session_id`

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

`GET /api/cost?dim=model` — `dim` is `model`, `effort`, `skill`, `subagent`, `mcp`, `repo`, `query_source`, or `tool`.

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
