# Findings

A finding is one row returned by a SQL rule. Aftertrace ships 13 rules. Each time you look, it runs every one of them against your store and shows you the rows that come back.

<!-- figure:findings -->
![Fig 5, Findings: a card-reading machine. A rack of thirteen thin cards with coloured index tabs stands on the left. The card being read lifts; a gantry sweeps a beam of coloured light across a bed of four panels, one per table, and the matching rows glow. A printer feeds a ticket into a tray with four compartments, high, medium, low and error, and a thread runs from the ticket back to the row it cites.](../images/figure-findings.png)

Point at a card to read that rule now. **←** and **→** step through the rack. **F** breaks the selected rule so you can see what a failure does.

## A rule is one SQL file

Every rule lives in [`internal/rules/files/`](../../internal/rules/files/). The build compiles those files into the binary, so there is nothing to install or configure. A copy sits in [`rules/`](../../rules/) for reading, and a test fails if the two drift apart.

A file has a few header comments, then a single `SELECT` (or `WITH ... SELECT`). Here is a whole rule, `tool_repeated_errors.sql`:

```sql
-- @id tool.repeated_errors
-- @title Repeated tool failures
-- @pillar bottleneck
-- @min_version 2.1.268

SELECT
  'medium' AS severity,
  tool_name || ' failed ' || count(*) || ' times with ' || coalesce(error_class, 'error') || ' in one session' AS headline,
  sum(exec_ms)/1000.0 AS impact_value,
  's spent on failing runs' AS impact_unit,
  'Target: ' || coalesce(full_command, bash_argv0, tool_name) || '. Each failure costs a model round trip to read and react to the error.' AS detail,
  'If the failure is environmental (missing deps, wrong cwd), fix it once and record the fix in CLAUDE.md so the model stops rediscovering it.' AS recommendation,
  to_json(list({'trace_id': trace_id, 'span_id': exec_span_id, 'label': coalesce(error_class, 'error')}
    ORDER BY start_ns))::VARCHAR AS evidence,
  json_array(session_id)::VARCHAR AS sessions
FROM tools
WHERE success='false'
GROUP BY session_id, tool_name, coalesce(full_command, bash_argv0, tool_name), error_class
HAVING count(*) >= 2;
```

The headers:

- `@id` names the rule. A file without an id fails to load.
- `@title` is the rule's name in the UI.
- `@pillar` says what kind of problem it finds: `bottleneck` (time), `cost` (money) or `config` (setup).
- `@min_version` is the Claude Code version whose attributes the query needs. It is recorded but not enforced. On older data the query simply returns no rows.

A rule usually reads the views (`tools`, `llm`, `calls`), not the raw tables. The views join spans to their events and pull the common attributes into columns. See [The store](store.md).

## What a finding holds

Each column the `SELECT` returns becomes one field. A column the query leaves out comes through empty or as 0.

| Field | Comes from | What it is |
| - | - | - |
| `rule_id`, `rule_title`, `pillar` | The headers | Which rule found it. |
| `severity` | `severity` | `high`, `medium` or `low`. Each rule sets its own thresholds; for example `permission.allow_rule_candidate` is high once more than 60 s was spent waiting. |
| `headline` | `headline` | One line saying what happened. |
| `impact_value`, `impact_unit` | `impact_value`, `impact_unit` | What it cost, as a number and a unit: `s waited`, `USD`, `calls failed`, `sessions`. The value is rounded to four decimals. |
| `detail` | `detail` | The specifics behind the headline. |
| `recommendation` | `recommendation` | What to change. The UI shows it as **Do this**. |
| `evidence` | `evidence` | A list of `{trace_id, span_id, label}`, one per span that proves the finding. |
| `sessions` | `sessions` | The session ids involved. |
| `id` | The engine | The finding's position after sorting. |

## How the engine runs them

1. **Load.** It reads every `.sql` file, parses the headers and sorts the rules by id. That order is the run order, and it is the order of the cards in the rack.
2. **Run.** It runs each rule as one query against the DuckDB store. Each row that comes back is one finding. A rule that matches nothing returns no rows, and nothing is shown for it.
3. **Contain failures.** If a query fails, that rule becomes one finding with severity `error` and the headline `Rule failed: …`. The other rules still run. If the files themselves cannot be loaded, you get a single `error` finding that says so.
4. **Sort.** Findings are ordered high, medium, low, then error. Within a severity, the larger impact comes first.

Rules run when something asks for findings:

- **The Findings page and session pages** run all the rules fresh each time they load.
- **The sidebar count** (`/api/status`) counts findings that are not errors. It reuses the last results for up to 10 seconds, so polling it does not re-run every rule. In the figure, that is the dial on the printer.
- **`aftertrace import <dir>`** prints every finding after it loads the files.

## The 13 rules

The **Reads** column lists what each query selects from: tables, or the views built on them. No shipped rule reads `metric_points`.

| Rule | Title | Pillar | Looks for | Reads | Impact unit | Needs |
| - | - | - | - | - | - | - |
| `app.errors` | Model calls failing | bottleneck | An app where 3+ model calls, and 5%+ of them, failed | `calls` | calls failed | Your apps' spans |
| `app.model_downgrade` | A smaller model would do | cost | A big model giving short answers (90% under 60 tokens) | `calls`, `prices` | USD | Your apps' spans |
| `app.no_prompt_cache` | Prompt caching is off | cost | 10+ long Anthropic calls with no cache reads or writes | `calls`, `prices` | USD at most | Your apps' spans |
| `cache.drop_after_compaction` | Cache drop after compaction | cost | A compaction, then a cache hit rate 30+ points lower | `events`, `llm` | USD on compaction and cache rewrite | |
| `hook.overhead` | Slow hooks | bottleneck | A hook averaging 1 s or more per run | `events` | s in hooks | |
| `mcp.large_results` | Large MCP tool results | cost | MCP tool results over 10,000 tokens | `tools`, `llm` | USD on requests that consumed them | `OTEL_LOG_TOOL_DETAILS=1` for server names |
| `model.switch_cache_rebuild` | Model switch rebuilt the cache | cost | A model switch that rebuilt the prompt cache | `llm` | USD on the rebuild request | |
| `permission.allow_rule_candidate` | Allow rule would remove repeated prompts | bottleneck | The same permission approved 3+ times | `tools` | s waited | `OTEL_LOG_TOOL_DETAILS=1` for exact Bash patterns |
| `plugin.skills_unused` | Plugin skills never used | config | A plugin's skills loaded in 3+ sessions, never used | `events` | sessions | `OTEL_LOG_TOOL_DETAILS=1` for plugin names |
| `retry.exhausted` | Retries exhausted | bottleneck | A request that ran out of retries | `events`, `spans` | s stalled | |
| `retry.waste` | Time lost to API retries | bottleneck | Successful requests that needed more than one attempt | `llm`, `span_events` | s lost to retries | |
| `skill.cost` | Expensive skill | cost | A skill that is 25%+ of cost, or $1+ per use | `llm`, `events` | USD | `OTEL_LOG_TOOL_DETAILS=1` for skill names |
| `tool.repeated_errors` | Repeated tool failures | bottleneck | The same tool failing the same way twice in a session | `tools` | s spent on failing runs | `OTEL_LOG_TOOL_DETAILS=1` for the full command |

The three `app.*` rules look only at model calls from your own apps: the `calls` view leaves out Claude Code's spans. The other ten look at Claude Code's telemetry. [Findings reference](../findings.md) has each rule's exact condition, evidence and advice.

## Reading one, and acting on it

1. **Headline and impact.** Read these first. The impact is what the problem cost in the data you have, in its own unit. A finding of 84 s waited is worth more of your attention than one of $0.40.
2. **Detail.** The specifics: which tool, which hook, which model, how many times.
3. **Do this.** The recommendation is written to be acted on directly: add an allow rule, mark a prompt prefix for caching, switch a model.
4. **Evidence.** Each chip is one span. Clicking it opens that trace's waterfall with the span selected, so you can see the moment itself. See [Reading a turn](turn.md).
5. **Mark as done.** This hides the finding in your browser only. Nothing is written to the store, and the rule still runs.

Some findings are coarse until Claude Code sends more detail. With `OTEL_LOG_TOOL_DETAILS=1`, an allow-rule finding names `Bash(npm test:*)` instead of `Bash(npm:*)`, and skill, plugin and MCP findings name the real skill, plugin or server. See [Connect Claude Code](../claude-code-setup.md).

## See also

- [Findings reference](../findings.md): every rule's condition, evidence, impact and advice.
- [Writing rules](../writing-rules.md): add your own SQL file and test it.
- [The store](store.md): the tables and views the rules read.
- [Reading a turn](turn.md): where an evidence chip takes you.
