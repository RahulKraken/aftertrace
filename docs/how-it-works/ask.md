# Ask

Ask answers plain-English questions about your own data. Claude writes SQL, Aftertrace checks it and runs it on your machine, and Claude answers from the rows. It is the only part of Aftertrace that sends anything off your machine, and it is off until you turn it on.

<!-- figure:ask -->
![Fig 7, Ask: two benches with a gap between them. On the long bench (your machine) stand a terminal, a card cabinet (the store), a press that stamps SQL slips, a guillotine that trims result sheets and a step dial. On the short bench (the Anthropic API) stands a teleprinter (the model). Two open channels cross the gap, one out and one in, and a sluice gate held down by a padlock closes both.](../images/figure-ask.png)

Point at a part to read it. **A** opens or locks the gate, **Space** asks the example question again, **W** sends a write to the read-only check.

## Turn it on

Ask needs two things: the `--ask` flag and an Anthropic API key in the environment of the `serve` process.

```bash
ANTHROPIC_API_KEY=sk-ant-... aftertrace serve --ask
```

At startup the log says which model it will use:

```
ask=claude-opus-5-5 (sends schema and query results to the Anthropic API)
```

- `--ask` without `ANTHROPIC_API_KEY` stops `serve` with `--ask: ANTHROPIC_API_KEY is not set`. It does not quietly start with Ask off.
- `AFTERTRACE_ASK_MODEL` picks another model. The default is `claude-opus-5-5`.
- `ANTHROPIC_BASE_URL` is honoured by the Anthropic SDK, so a gateway or proxy works.
- `aftertrace service install --ask` refuses: a login service does not inherit `ANTHROPIC_API_KEY` from your shell. Run Ask from a shell with `aftertrace serve --ask`.

Ask lives on the **Query** page, on the **Ask** tab. The same thing is `POST /api/ask` with `{"question": "..."}` ([JSON API](../api.md)).

## What happens to one question

The figure plays one question from start to finish: *"Which tools wait on me for approval the most?"*

1. **The question and the schema go out.** Aftertrace sends your question, plus a system prompt that holds the schema. The schema is the columns of `spans`, `span_events`, `events`, `metric_points` and the views `llm`, `tools` and `turn_roots`, and the 25 most common span names and event names with their counts. That is call 1 on the dial.
2. **Claude answers with a tool call.** It has two tools: `run_sql` takes one SQL statement, and `final_answer` ends the loop.
3. **The read-only check (the press).** Before anything runs, Aftertrace refuses:
   - a statement with a semicolon anywhere but the end;
   - a statement that does not start with `SELECT` or `WITH`;
   - a statement that DuckDB itself does not parse as a `SELECT`. This catches `WITH ... INSERT`, which starts with `WITH`.

   A refusal reads `Only a single SELECT or WITH statement is allowed.`
4. **It runs on the store.** The query runs inside a transaction that is always rolled back. The store is opened with external access off and its configuration locked: no files, no network, no `ATTACH`, no extensions ([Privacy](../privacy.md#sql-sandbox)). At most 500 rows come back locally.
5. **The cutter.** Before the rows go back to Claude, Aftertrace keeps the first 50. It cuts every string, and every JSON value, longer than 200 characters to 200 characters, and appends `…[truncated]`. It also sends `total_rows`, the number of rows the query returned locally.
6. **Errors go back too.** A refusal or a DuckDB error goes back as a tool error, so Claude can fix its query. In the example, the first query names a column that does not exist and the second one works.
7. **Repeat, up to 8 calls.** Each round trip to the model is one call on the dial. After 8 calls without an answer, Ask stops with `no answer after 8 steps`.
8. **The answer comes back.** `final_answer` carries three things:
   - two to five plain sentences;
   - the one query that best supports them;
   - up to five trace ids as evidence.
9. **Back on your machine.** Aftertrace runs that query again, through the same check, and shows up to 200 rows as a table under the answer. It turns the trace ids into evidence links labelled with the turn's prompt and duration. Neither the table nor the labels are sent anywhere.

If Claude replies in plain text without calling `final_answer`, that text is taken as the answer. A whole question has 3 minutes.

## What leaves your machine, and what never does

Sent to the Anthropic API, and only while Ask is on:

| Sent | Detail |
|---|---|
| Your question | as you typed it |
| The schema | the columns of 7 tables and views, and the 25 most common span names and event names with their counts |
| Query results | at most 50 rows per query, strings cut to 200 characters, plus the row count |
| Error text | a refusal or a DuckDB error message, so Claude can fix its query |

Never sent:

- the store file, or any table in full;
- rows Claude did not ask for;
- the answer's table and its evidence labels, which are built on your machine;
- anything at all while Ask is off. The Query page says so.

The system prompt tells Claude never to select prompt text, response text, tool input or tool output. If it did, those values would be cut to 200 characters anyway. Without `--store-content`, that content is never in the store in the first place ([Redaction](redaction.md)).

## A worked example

The question is *"Which tools wait on me for approval the most?"*

Call 1. Claude writes:

```sql
SELECT tool_name, sum(wait_seconds) FROM tools GROUP BY 1
```

It passes the read-only check. DuckDB rejects it because `tools` has no `wait_seconds` column, and the error goes back to Claude.

Call 2. Claude reads the schema again and fixes the query:

```sql
SELECT tool_name, round(sum(wait_ms)/1000) AS waited_s
FROM tools GROUP BY 1 ORDER BY 2 DESC
```

It runs locally and returns 23 rows. Claude receives them in this shape, cut to 50 rows at most (synthetic numbers):

```json
{"columns":["tool_name","waited_s"],"rows":[["Bash",252],["Edit",96],["WebFetch",41]],"total_rows":23}
```

Call 3. Claude calls `final_answer` with two sentences, the second query, and the trace ids of the longest waits. Aftertrace runs the query again for the table on the page.

## Model, cost and limits

Each question makes between 1 and 8 calls to the Anthropic API, billed to your key. Within one question the system prompt, which holds the schema, is marked for prompt caching, so later calls can read it from the cache instead of paying for it again. To spend less, set `AFTERTRACE_ASK_MODEL` to a smaller model.

| Limit | Value | Where |
|---|---|---|
| Model calls per question | 8 | `maxSteps`, `internal/ask/ask.go` |
| Rows sent per query | 50 | `maxRowsToModel` |
| Characters per string sent | 200 | `maxCellToModel` |
| Rows a query returns locally | 500 | `internal/api/ask.go` |
| Rows shown under the answer | 200 | `maxRowsReturned` |
| Evidence links | 5 | `internal/api/ask.go` |
| Time per question | 3 minutes | `internal/api/ask.go` |
| Output tokens per call | 16,000 | `internal/ask/ask.go` |
| SDK retries per call | 2 | `internal/ask/ask.go` |

## Turn it off

Restart `serve` without `--ask`. With Ask off, `POST /api/ask` answers locally that Ask is off and makes no network call. `GET /api/ask/suggestions` reports `enabled: false`.

## See also

- [Privacy](../privacy.md): everything Aftertrace stores and drops, and the SQL sandbox.
- [The store](store.md): the tables and views Claude queries.
- [JSON API](../api.md): `POST /api/ask` and `POST /api/sql`.
