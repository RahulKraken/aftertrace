# The store

Everything Aftertrace keeps is in one DuckDB file on your machine. Four tables hold what arrived, two small tables hold the AI plans you pay for, and five views join traces into what the UI, the rules and Ask read.

<!-- figure:store -->
![Fig 4, the store: a card-catalogue cabinet on a base plate that is the DuckDB file. Batches wait in a trough at a gate; a single lift car carries one at a time up to its drawer. Four drawers are the four tables; the top two have a rod through their cards (a key), the bottom two do not. A rack of five standing reading frames is the views, a small box of price cards sits behind them, a ledger in front is the write-ahead log, and a sealed hatch on the cabinet's side is the sandbox.](../images/figure-store.png)

Point at a drawer to open it, or at a frame to see which tables that view reads. **R** sends the last batches again.

## The file

- **Where.** `~/.aftertrace/aftertrace.duckdb` by default. `serve`, `import`, `demo` and `service install` all take `--db` to use another path.
- **The WAL.** Next to it is `aftertrace.duckdb.wal`, DuckDB's write-ahead log. Each write is logged there before it reaches the file, which is why deleting the store means deleting both ([Privacy](../privacy.md#how-to-delete-it)).
- **One process at a time.** DuckDB takes an exclusive lock on the file. A second `serve`, `import` or `demo` on the same path fails with `Conflicting lock is held` ([Troubleshooting](../troubleshooting.md#duckdb-lock)).
- **A sealed file.** Aftertrace opens it with `enable_external_access=false` and `lock_configuration=true`. No query can read another file, `ATTACH` a database or `INSTALL` an extension, and no `SET` can turn that back on.
- **Nothing is deleted for you.** No code path removes rows. The file grows with what you send until you delete it.

## How data goes in

The receivers turn every OTLP export into rows ([Receiving](receive.md)), and redaction removes keys first ([Redaction](redaction.md)). Then one call writes the batch:

1. It takes the store's one write lock. Only one batch is written at a time. Batches that arrive meanwhile wait their turn.
2. It opens a transaction and inserts the batch's spans, span events, events and metric points.
3. It commits, which makes the whole batch visible at once, and releases the lock.

Reads never take that lock. DuckDB gives every query a snapshot of the last commit, so a slow page or rule never holds up ingest, and ingest never holds up a page.

## The four tables

Two tables have a primary key and are written with `INSERT OR REPLACE`. If a collector retries an export, or you import the same files twice, each span lands on its own key and replaces the copy already there. The other two have no key and are plain `INSERT`s, so a batch sent twice is stored twice. The figure's **R** shows both.

`attrs` and `resource` are JSON. They hold the record's attributes and its resource attributes, as they arrived minus the redacted keys.

### `spans`

One row per span. Key: `trace_id` + `span_id`.

| Column | Type | What it holds |
|---|---|---|
| `trace_id`, `span_id` | VARCHAR | Hex ids. Together, the key. |
| `parent_span_id` | VARCHAR | NULL for a root span. |
| `name` | VARCHAR | For example `claude_code.llm_request` or `claude_code.tool`. |
| `start_ns`, `end_ns` | BIGINT | Unix nanoseconds. |
| `duration_ms` | DOUBLE | `end_ns - start_ns`, in milliseconds. |
| `is_error` | BOOLEAN | True when the span's status code is `ERROR`. |
| `status_message` | VARCHAR | The status message, or NULL. |
| `session_id` | VARCHAR | The `session.id` attribute, or the resource's if the span has none. |
| `attrs`, `resource` | JSON | Everything else. |

Indexes on `session_id` and `name`.

### `span_events`

Events recorded inside a span, such as `gen_ai.request.attempt`, one per attempt of a model request. Key: `trace_id` + `span_id` + `name` + `time_ns`. Columns: those four, plus `attrs`.

### `events`

One row per log record. Claude Code sends its events as logs. The `name` comes from the `event.name` attribute or the log body, with the `claude_code.` prefix removed, for example `api_request`, `tool_decision` or `compaction`. No key.

| Column | Type | What it holds |
|---|---|---|
| `ts_ns` | BIGINT | The record's time, or its observed time if it has none. |
| `name` | VARCHAR | The event name. |
| `session_id`, `prompt_id` | VARCHAR | From `session.id` and `prompt.id`. |
| `trace_id`, `span_id` | VARCHAR | The span the record was logged under, if any. |
| `request_id`, `tool_use_id` | VARCHAR | Pulled out of `attrs` so joins to spans are cheap. |
| `attrs`, `resource` | JSON | Everything else. |

Indexes on `session_id`, `name`, `request_id`, `tool_use_id` and `trace_id`.

### `metric_points`

One row per data point of a sum or a gauge. Histograms and summaries are not stored. No key.

| Column | Type | What it holds |
|---|---|---|
| `name`, `unit` | VARCHAR | For example `claude_code.cost.usage`, `USD`. |
| `ts_ns` | BIGINT | The data point's time. |
| `value` | DOUBLE | Integer points are stored as doubles. |
| `session_id` | VARCHAR | From `session.id` on the point or its resource. |
| `attrs`, `resource` | JSON | The point's attributes, such as `model` or `type`. |

### `prices`

The price list for model calls that do not report a cost. It is rewritten from the binary every time the store opens: one row per model-id prefix for Anthropic, OpenAI and Google models, with input, cache write, cache read and output prices in USD per million tokens. The longest matching prefix wins. Claude Code reports its own cost, so this is only used for your apps ([Apps and agents](../apps.md)).

### `plan_catalog` and `subscriptions`

A bundled list of common AI plans (ChatGPT, Claude, Gemini, Grok / The X Subscription, Perplexity, Cursor, GitHub Copilot, Midjourney, and API pay-as-you-go) and the rows you add on **Plans**. `plan_catalog` is rewritten from the binary on every open, like `prices`; every listed amount has a `source_url` and `sourced_at`, and the price is left blank when the official page did not show one. `subscriptions` is yours: vendor, plan name, price, currency, billing period, renewal day, start date, active or cancelled. Yearly prices are divided by 12 for the monthly total. Usage-based rows are estimated from `calls` when Aftertrace already has that provider's traces.

## The five views

The views do the joins once, so the UI, the [rules](findings.md) and Ask read one row per thing instead of reassembling spans and events. They also pull the attributes you query most out of JSON into columns.

| View | One row per | Reads | What it adds |
|---|---|---|---|
| `llm` | Claude Code model request | `spans`, `events` | The `llm_request` span joined to its `api_request` event on `request_id`: `model`, `effort`, tokens and cache tokens, `ttft_ms`, `attempt`, `cost_usd`, and the skill, agent or MCP tool that made the request. |
| `tools` | Claude Code tool call | `spans`, `events` | The `tool` span with its permission wait (`wait_ms`, `decision`, `decision_source`) and its execution (`exec_ms`, `success`). |
| `q_spans` | span | `spans`, `events` | Every span, with the `api_request` attributes and `cost_usd` merged onto model requests. It is what the Query page searches. |
| `turn_roots` | turn | `spans` | The `claude_code.interaction` span of each finished turn. A turn still running has no such span yet, so its root is inferred from the missing parent its spans point at, with `in_progress = true`. |
| `calls` | model call from your own apps | `spans`, `prices` | Calls from the OpenTelemetry GenAI conventions, the Claude SDK, OpenLLMetry, OpenInference, the Vercel AI SDK, Pydantic AI and Gemini CLI, normalised to `service`, `model`, tokens and `cost_usd`. Uses the reported cost when there is one and prices it from `prices` when there isn't. |

Two helper macros come with them. `a(attrs, 'key')` reads a JSON attribute as text and `n(attrs, 'key')` reads one as a number.

## Querying it yourself

While Aftertrace runs, send one read-only `SELECT` or `WITH` to its API. It returns up to 500 rows, and the transaction is always rolled back ([JSON API](../api.md)):

```bash
curl -s localhost:7311/api/sql -H 'content-type: application/json' \
  -d '{"sql": "SELECT model, count(*) AS requests, round(sum(cost_usd), 2) AS usd FROM llm GROUP BY model ORDER BY usd DESC"}'
```

To use the DuckDB CLI instead, stop Aftertrace first (the file is locked while it runs), then `duckdb ~/.aftertrace/aftertrace.duckdb`.

Some queries to start from:

```sql
-- Which tools keep you waiting at the permission prompt
SELECT tool_name, count(*) AS calls, round(avg(wait_ms)) AS avg_wait_ms
FROM tools WHERE wait_ms IS NOT NULL
GROUP BY tool_name ORDER BY avg_wait_ms DESC LIMIT 5;

-- Turns per session and how long they take
SELECT session_id, count(*) AS turns, round(avg(duration_ms) / 1000, 1) AS avg_s
FROM turn_roots GROUP BY session_id;

-- What your own apps spend, by service and model
SELECT service, model, count(*) AS calls, round(sum(cost_usd), 4) AS usd
FROM calls GROUP BY ALL;

-- An attribute straight from the JSON, with the a() macro
SELECT a(attrs, 'tool_name') AS tool, count(*) AS n
FROM spans WHERE name = 'claude_code.tool'
GROUP BY tool ORDER BY n DESC;

-- Events stored more than once (they have no key)
SELECT name, count(*) - count(DISTINCT (ts_ns, attrs::VARCHAR)) AS extra_copies
FROM events GROUP BY name HAVING extra_copies > 0;
```

What every attribute means, and which Claude Code version sends it, is in [Schema notes](../schema-notes.md).
