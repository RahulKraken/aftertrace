# Aftertrace

**The flight recorder for your AI work.** See what Claude Code, your agents and the apps you build with LLMs actually did: how long you waited, what it cost, and the one change worth making next.

One binary on your machine. Your data never leaves it.

[Website](https://rahulkraken.github.io/aftertrace/) · [Live demo](https://rahulkraken.github.io/aftertrace/demo/) · [Docs](https://rahulkraken.github.io/aftertrace/docs/how-it-works.html) · [Changelog](CHANGELOG.md)

<a href="https://rahulkraken.github.io/aftertrace/docs/how-it-works.html"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/readme/fig1-dark.webp"><img alt="Fig 1, How Aftertrace works: an instrument bench. Sources feed a junction box (the OTLP receivers), light runs along a trough through a sieve (redaction) into a cabinet of four drawers (the DuckDB tables), a carriage of 13 rule templates reads the drawers and drops finding cards in a tray, and a screen (the UI) and a locked outbox (Ask) sit at the end." src="docs/images/readme/fig1-light.webp"></picture></a>

<sub>How it works, in one machine. Click it to explore it live.</sub>

<picture><source media="(prefers-color-scheme: dark)" srcset="web/screenshots/home-dark.png"><img alt="Aftertrace Home: a sentence about the week, agent time, waiting on you, API value, what shipped, a running session, the next finding and where the time went" src="web/screenshots/home-light.png"></picture>

It reads the OpenTelemetry that Claude Code (and any OTel-instrumented app) already exports, keeps it in a local DuckDB file, and turns it into findings like these, each linked to the spans behind it:

```
[high]   5 permission prompts for Bash(npm test:*), all approved
[high]   An API request gave up after 11 attempts
[medium] support-bot · POST /api/classify uses claude-opus-5-5 for 11-token answers
[medium] Cache hit rate fell from 98% to 0% after auto compaction
[medium] Hook PreToolUse:Bash averages 2.2s per run
```

## Install

```bash
curl -fsSL https://rahulkraken.github.io/aftertrace/install.sh | sh
aftertrace serve
```

Open http://127.0.0.1:7311 and go to **Connect**. macOS and Linux; Windows and building from source: [docs/install.md](docs/install.md). `aftertrace demo` loads synthetic sessions and apps if you want to look around first.

To keep it running across logouts and restarts, stop it and run `aftertrace service install` instead (a LaunchAgent on macOS, a systemd user unit on Linux). It takes the same flags as `serve`: [docs/install.md](docs/install.md#run-it-at-login).

## Build from source

You need Go 1.24, a C compiler (DuckDB is linked with CGO), and Node 22. See [docs/install.md](docs/install.md).

```bash
cd web && npm ci && npm run build:embed && cd ..
go build -o aftertrace ./cmd/aftertrace
./aftertrace demo --db ./data/aftertrace.duckdb
./aftertrace serve --db ./data/aftertrace.duckdb
```

Open http://127.0.0.1:7311. `aftertrace demo` loads six synthetic Claude Code sessions and three synthetic apps that trigger every built-in rule, so you can look around before you connect anything. Demo records carry `aftertrace.synthetic=true`.

## Connect Claude Code

Add this to `~/.claude/settings.json` (Claude Code ignores these keys in a repository `.claude/settings.json`), then restart Claude Code:

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA": "1",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_TRACES_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "grpc",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://127.0.0.1:4317",
    "OTEL_LOG_TOOL_DETAILS": "1"
  }
}
```

Run `aftertrace serve`. Your next turn shows up in the Sessions view.

- `OTEL_LOG_TOOL_DETAILS=1` gives real skill, MCP and Bash command names. It also records Bash commands and file paths. Aftertrace keeps those on your machine.
- To send over HTTP instead of gRPC, or to check that data is arriving, see [docs/claude-code-setup.md](docs/claude-code-setup.md).
- If you already run an OpenTelemetry Collector, see [docs/behind-a-collector.md](docs/behind-a-collector.md).

## What you get

**Home.** One sentence about your week, then agent time, time waiting on you, API value, what shipped and cache hit rate, each against last week. Live lanes show every turn still running across your sessions.

**Findings.** Each finding comes from a SQL rule over your local data. It has an impact in seconds or dollars, a recommendation you can act on, and evidence chips that open the waterfall on the span that triggered it.

| Rule | What it catches |
| - | - |
| `permission.allow_rule_candidate` | Prompts you always approve; suggests the allow rule |
| `retry.waste` | Time lost to API retries |
| `retry.exhausted` | Requests that gave up after retrying |
| `tool.repeated_errors` | The same tool failing again and again |
| `hook.overhead` | Slow hooks |
| `skill.cost` | Skills that drive a large share of spend |
| `mcp.large_results` | MCP tools that return large results |
| `cache.drop_after_compaction` | Cache hit rate collapsing after compaction |
| `model.switch_cache_rebuild` | A mid-session model switch that rebuilt the cache |
| `plugin.skills_unused` | Plugins whose skills load but never activate |
| `app.model_downgrade` | An app operation using a large model for short answers |
| `app.errors` | An app whose model calls fail often |
| `app.no_prompt_cache` | Large Anthropic prompts sent with no caching |
| `plan.barely_used` | A plan you pay for and barely used this month |

Details for each rule: [docs/findings.md](docs/findings.md).

**Trace.** One trace is one turn, and it opens as a story: what you asked, where the time went, where it ended, then each step in Claude's words with its actions in plain English and the moments it waited for you. The Timeline view puts the same steps on one time axis, folds long waits, and splits wall-clock time into model, tool run, waiting on you, retry waste, hooks and permission checks. Click any action or span for its metrics, cost, input and output (when you opt into content), joined events and the findings that cite it.

**Sessions.** One row per session, titled by your first prompt, with filters, search, agent time, waiting time and cost. Turns in progress appear while they run.

**Apps.** Your own services and agents sending OpenTelemetry GenAI spans (Claude SDK, Vercel AI SDK, Pydantic AI, OpenLLMetry, OpenInference): calls, cost, latency and failures per app and per operation. [docs/apps.md](docs/apps.md).

**Cost and Query.** Spend by source, model, skill, subagent, MCP server, tool and repo. A query builder and read-only SQL against the same store, and every result links back to its traces. **Ask** (opt-in, `aftertrace serve --ask`) answers plain-English questions with SQL written by Claude.

**Plans.** Everything you pay for AI, kept in the same local DuckDB file. Tick a catalog plan (ChatGPT, Claude, Gemini, Grok, Perplexity, Cursor, Copilot, Midjourney, or an API) and confirm the listed price, or add something else. The monthly total is the page: yearly plans are divided by 12, usage-based spend is estimated from traces Aftertrace already has. Prices come from official pages with a date and URL; blank when the page did not list one.

**Recap.** Your week as a short report and a receipt you can copy as an image: hours of agent work, what shipped, minutes waiting, API value against your plan, and this month's AI total from Plans.

## How it works

The figure at the top is the whole system. One Go binary with DuckDB and the web UI embedded. Sources send OpenTelemetry to `127.0.0.1:4317` (gRPC) or `:4318` (HTTP). Identity is dropped at the door, and content is too unless you ask to keep it. What is left goes into one DuckDB file, 14 SQL rules turn it into findings, and the UI on `127.0.0.1:7311` reads the same file. Nothing leaves your machine unless you switch on Ask.

Each part, up close. Click one to open it live: point at its parts, press its keys, and watch the light run through it.

<table>
<tr>
<td width="50%" valign="top"><a href="https://rahulkraken.github.io/aftertrace/docs/how-it-works/receive.html"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/readme/fig2-dark.webp"><img alt="Fig 2, Receiving: a sorting bench where exports enter two sockets, pass a size gauge and a decoder, and are unpacked into four bins, one per table" src="docs/images/readme/fig2-light.webp"></picture></a><br><b><a href="https://rahulkraken.github.io/aftertrace/docs/how-it-works/receive.html">Receiving</a></b><br>OTLP over gRPC on 4317 and HTTP on 4318; each signal becomes rows</td>
<td width="50%" valign="top"><a href="https://rahulkraken.github.io/aftertrace/docs/how-it-works/redaction.html"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/readme/fig3-dark.webp"><img alt="Fig 3, Redaction: a coin sorter where red identity tokens always fall out, indigo content tokens fall out unless a shutter covers the slot, and the rest roll on to the store" src="docs/images/readme/fig3-light.webp"></picture></a><br><b><a href="https://rahulkraken.github.io/aftertrace/docs/how-it-works/redaction.html">Redaction</a></b><br>Identity always dropped, content dropped unless you keep it</td>
</tr>
<tr>
<td width="50%" valign="top"><a href="https://rahulkraken.github.io/aftertrace/docs/how-it-works/store.html"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/readme/fig4-dark.webp"><img alt="Fig 4, The store: a lift carries batches into a cabinet of four drawers, with a rack of reading frames for the views" src="docs/images/readme/fig4-light.webp"></picture></a><br><b><a href="https://rahulkraken.github.io/aftertrace/docs/how-it-works/store.html">The store</a></b><br>One DuckDB file, four tables, five views, one writer</td>
<td width="50%" valign="top"><a href="https://rahulkraken.github.io/aftertrace/docs/how-it-works/findings.html"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/readme/fig5-dark.webp"><img alt="Fig 5, Findings: a rack of rule cards, a gantry that reads the store bed with light, and a printer that drops finding tickets into a tray by severity" src="docs/images/readme/fig5-light.webp"></picture></a><br><b><a href="https://rahulkraken.github.io/aftertrace/docs/how-it-works/findings.html">Findings</a></b><br>14 SQL rules read the store and print findings with evidence</td>
</tr>
<tr>
<td width="50%" valign="top"><a href="https://rahulkraken.github.io/aftertrace/docs/how-it-works/turn.html"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/readme/fig6-dark.webp"><img alt="Fig 6, Reading a turn: a chart recorder whose pens draw model requests, tools, retries and waits on you, with beads counting where each second went" src="docs/images/readme/fig6-light.webp"></picture></a><br><b><a href="https://rahulkraken.github.io/aftertrace/docs/how-it-works/turn.html">Reading a turn</a></b><br>How one Claude Code turn becomes the story and the waterfall</td>
<td width="50%" valign="top"><a href="https://rahulkraken.github.io/aftertrace/docs/how-it-works/ask.html"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/readme/fig7-dark.webp"><img alt="Fig 7, Ask: a terminal and the store on your bench, a read-only stamp and a cutter on the channel out, and a locked gate before the model" src="docs/images/readme/fig7-light.webp"></picture></a><br><b><a href="https://rahulkraken.github.io/aftertrace/docs/how-it-works/ask.html">Ask</a></b><br>Off by default; read-only SQL, trimmed rows, nothing else leaves</td>
</tr>
</table>

It can also import an OpenTelemetry Collector's file-exporter JSONL (`aftertrace import`). Commands and flags: [docs/cli.md](docs/cli.md). JSON API: [docs/api.md](docs/api.md).

## Private by default

- Binds to `127.0.0.1`. No telemetry, no update check, no phone-home.
- Prompt, response and tool content attributes are dropped at ingest unless you pass `--store-content`. Email, account and organization ids and the OS user name are always dropped.
- Ask is off by default. Turned on, it sends the question, the schema and query rows to the Anthropic API, nothing else.
- Everything lives in one DuckDB file, by default `~/.aftertrace/aftertrace.duckdb`. Delete it (and its `.wal`) to wipe your data.

More: [docs/privacy.md](docs/privacy.md).

## Write a rule

A rule is one SQL file that returns one row per finding. You write SQL, not Go:

```sql
-- @id hook.overhead
-- @title Slow hooks
-- @pillar bottleneck
SELECT 'medium' AS severity, 'Hook ... averages 2.2s per run' AS headline, ...
```

The format, the views you can query (`llm`, `tools`, `calls`, `turn_roots`, `q_spans`) and a worked example: [docs/writing-rules.md](docs/writing-rules.md). New rules are the most useful contribution you can make.

## Status

Early: v0.4. Aftertrace is built and tested against Claude Code's documented telemetry and real sessions from Claude Code 2.1.x (version 2.1.0 or later, with the enhanced telemetry beta). Some of that telemetry is in beta and may change. Expect rough edges, and please [open an issue](https://github.com/RahulKraken/aftertrace/issues) when something looks wrong.

## Docs

[How it works](docs/how-it-works.md) · [Install](docs/install.md) · [Claude Code setup](docs/claude-code-setup.md) · [Apps and agents](docs/apps.md) · [Behind a collector](docs/behind-a-collector.md) · [CLI](docs/cli.md) · [Findings](docs/findings.md) · [Writing rules](docs/writing-rules.md) · [JSON API](docs/api.md) · [Privacy](docs/privacy.md) · [Troubleshooting](docs/troubleshooting.md) · [Product brief](docs/product/brief.md) · [Contributing](CONTRIBUTING.md)

## License

[Apache-2.0](LICENSE).
