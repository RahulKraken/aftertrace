# Writing a rule

> [How the engine runs rules, with a figure →](how-it-works/findings.md)

A rule is one SQL file. Contributors write SQL, not Go. The binary embeds the files under `internal/rules/files/` at build time, so you copy the same bytes into both trees.

## File format

`rules/<name>.sql` and `internal/rules/files/<name>.sql` must match. `TestRepoRulesMatchEmbedded` fails if they drift.

Header comments, then a single `SELECT` (or `WITH ... SELECT`) that returns one row per finding:

```sql
-- @id example.slow_ttft
-- @title Slow time to first token
-- @pillar bottleneck
-- @min_version 2.1.268

SELECT
  'medium' AS severity,
  ...
```

| Header | Required | Meaning |
| - | - | - |
| `-- @id` | yes | Stable id, dotted. Becomes `rule_id` on the finding. |
| `-- @title` | no | Shown in the UI as `rule_title`. |
| `-- @pillar` | no | `bottleneck`, `cost`, or `config`. |
| `-- @min_version` | no | Claude Code version whose attributes you need. Parsed, not used to skip yet. |

The SELECT must alias these columns (missing ones become empty / 0):

| Column | Type | Role |
| - | - | - |
| `severity` | text | `high`, `medium`, or `low`. `error` is reserved for engine failures. |
| `headline` | text | One line. |
| `impact_value` | number | Sorted descending within a severity. |
| `impact_unit` | text | `s waited`, `USD`, `sessions`, ... |
| `detail` | text | What happened. |
| `recommendation` | text | What to change. |
| `evidence` | JSON text | `[{trace_id, span_id, label}, ...]`. UI chips. Empty list if you have no span. |
| `sessions` | JSON text | `["session-id", ...]`. |

DuckDB JSON helpers used by shipped rules: `json_array`, `json_object`, `to_json(list(...))`, then `::VARCHAR` so the driver returns text.

A failing statement becomes one `severity = error` finding for that rule. Other rules still run.

## Tables, views, macros

Defined in [`internal/store/schema.sql`](../internal/store/schema.sql) and [`internal/store/views.sql`](../internal/store/views.sql). Raw attributes stay JSON so new Claude Code keys do not need a migration.

Macros:

```sql
a(j, k)  -- json_extract_string(j, '$."k"')
n(j, k)  -- TRY_CAST of that to DOUBLE
```

Tables:

| Table | Grain |
| - | - |
| `spans` | One span. `trace_id`, `span_id`, `parent_span_id`, `name`, `start_ns`, `end_ns`, `duration_ms`, `is_error`, `status_message`, `session_id`, `attrs` JSON, `resource` JSON. |
| `span_events` | `gen_ai.request.attempt`, `tool.output`, ... |
| `events` | One log record. `name` has the `claude_code.` prefix stripped. `request_id` / `tool_use_id` / `prompt_id` promoted to columns. |
| `metric_points` | One number data point. |

Views:

| View | Grain |
| - | - |
| `llm` | `claude_code.llm_request` joined to `api_request` on `request_id`. Adds `cost_usd`, `skill_name`, `mcp_server_name`, tokens, `model`, `effort`. |
| `tools` | `claude_code.tool` plus `blocked_on_user` and `execution` children. |
| `q_spans` | Every span with joined `api_request` attrs for model rows. |
| `turn_roots` | One row per Claude Code turn, including turns still running (`in_progress`). |
| `calls` | One model call from an app or agent (anything not Claude Code), normalised across OpenTelemetry GenAI, the Claude SDK, OpenLLMetry, OpenInference, the Vercel AI SDK, Pydantic AI and Gemini CLI. `service`, `operation`, `provider`, `model`, `model_key`, tokens (`input_tokens` includes cache), `ttft_ms`, `cost_usd` (reported, or estimated from `prices`), `cost_reported`, `error_type`, `conversation_id`. |
| `prices` | USD per million tokens by model-id prefix: `input`, `cache_write`, `cache_read`, `output`. Match with `starts_with(model_key, prefix)` and take the longest prefix. |

Queries are read-only. Do not `INSERT`/`UPDATE`/`CREATE`.

## Worked example

Time to first token on the main thread, p95 ≥ 8s. Not a shipped rule; copy it if you want it.

`rules/example_slow_ttft.sql` (and the same file under `internal/rules/files/`):

```sql
-- @id example.slow_ttft
-- @title Slow time to first token
-- @pillar bottleneck
-- @min_version 2.1.268

WITH slow AS (
  SELECT trace_id, span_id, session_id, model, effort, ttft_ms, cost_usd
  FROM llm
  WHERE agent_id IS NULL
    AND ttft_ms IS NOT NULL
    AND ttft_ms >= 8000
)
SELECT
  'medium' AS severity,
  'p95 time to first token on ' || coalesce(model, '?') || ' is ' ||
    printf('%.1f', quantile_cont(ttft_ms, 0.95) / 1000.0) || 's' AS headline,
  quantile_cont(ttft_ms, 0.95) / 1000.0 AS impact_value,
  's ttft p95' AS impact_unit,
  count(*) || ' main-thread requests over 8s ttft. Worst ' ||
    printf('%.1f', max(ttft_ms) / 1000.0) || 's on effort ' ||
    coalesce(mode(effort), 'none') || '.' AS detail,
  'Usually load or a large context. Check context size and whether a cheaper model on this work has acceptable ttft.' AS recommendation,
  to_json(list({'trace_id': trace_id, 'span_id': span_id, 'label':
    coalesce(model, '?') || ' ttft ' || printf('%.1f', ttft_ms / 1000.0) || 's'}
    ORDER BY ttft_ms DESC)[:5])::VARCHAR AS evidence,
  to_json(list(DISTINCT session_id))::VARCHAR AS sessions
FROM slow
GROUP BY model
HAVING count(*) >= 1;
```

## Test

`internal/integration_test.go` loads `aftertrace demo` data and asserts every shipped rule fires, and that none attach to the clean haiku session.

For a new shipped rule that the demo should illustrate:

1. Add a scenario in `internal/demo/sessions.go` so the SQL has rows.
2. Add the id to `need` in `TestRulesFireOnIntendedScenariosAndStaySilentOnCleanSession`.
3. Keep the clean haiku session uncited.

```go
need := []string{
    "permission.allow_rule_candidate",
    "retry.waste",
    // ...
    "example.slow_ttft",
}
```

A rule that should stay silent on demo data gets its own test with a tiny DuckDB fixture, or you assert `len(got["example.slow_ttft"]) == 0` on the demo store.

Run:

```bash
go test ./internal/rules -count=1
go test ./internal/ -run TestRulesFire -count=1
go test ./...
```

Then `aftertrace demo --db ./data/aftertrace.duckdb` and confirm the new headline prints. Rebuild the binary after copying the SQL into `internal/rules/files/`; embed happens at `go build`.

Do not commit real traces, emails, or paths. The demo generator is the fixture.

PR expectations: [CONTRIBUTING.md](../CONTRIBUTING.md).
