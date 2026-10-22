# Aftertrace

**See where your Claude Code time and money go, and what to change.**

Aftertrace is a profiler for Claude Code that runs on your machine. It reads the OpenTelemetry data Claude Code already exports and turns it into findings like these, each linked to the exact spans behind it:

```
[high]   5 permission prompts for Bash(npm test:*), all approved
[high]   An API request gave up after 11 attempts
[medium] Skill pdf-report drove 33% of spend
[medium] Cache hit rate fell from 98% to 0% after auto compaction
[medium] Hook PreToolUse:Bash averages 2.2s per run
```

Your data stays in a local DuckDB file. No account, no telemetry, no phone-home.

![A Claude Code turn in the Aftertrace waterfall: model calls, tool runs, and a 30s wait on a permission prompt for `Bash npm test`](docs/images/waterfall.png)

<!-- TODO: link to the hosted demo here once it exists. -->

## Try it in a minute

You need Go 1.24, a C compiler (DuckDB is linked with CGO), and Node 22. See [docs/install.md](docs/install.md).

<!-- TODO: replace with `brew install` once releases exist. -->

```bash
cd web && npm ci && npm run build:embed && cd ..
go build -o aftertrace ./cmd/aftertrace
./aftertrace demo --db ./data/aftertrace.duckdb
./aftertrace serve --db ./data/aftertrace.duckdb
```

Open http://127.0.0.1:7311. `aftertrace demo` loads six synthetic sessions that trigger every built-in rule, so you can look around before you connect anything. Demo records carry `aftertrace.synthetic=true`.

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

Details for each rule: [docs/findings.md](docs/findings.md).

**Waterfall.** One trace is one turn. Wall-clock time is split into model, tool run, waiting on you, retry waste and hooks, and the critical path is highlighted. Click any span for its attributes, cost and the findings that cite it.

**Sessions.** One row per session, with time, cost, cache hit rate and where the time went.

**Cost and Query.** Spend by model, skill, subagent, MCP server, tool and repo. A query builder and read-only SQL against the same store, and every result links back to its traces.

## Private by default

- Binds to `127.0.0.1`. No telemetry, no update check, no phone-home.
- Prompt, response and tool content attributes are dropped at ingest unless you pass `--store-content`. `user.email` and account IDs are always dropped.
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

The format, the views you can query (`llm`, `tools`, `q_spans`) and a worked example: [docs/writing-rules.md](docs/writing-rules.md). New rules are the most useful contribution you can make.

## How it works

```
Claude Code ── OTLP gRPC :4317 / HTTP :4318 ──▶ aftertrace ──▶ DuckDB (local file)
                                                    │
                                     SQL rules ─────┤
                                                    ▼
                                    UI + JSON API on 127.0.0.1:7311
```

One Go binary with DuckDB and the web UI embedded. It can also import an OpenTelemetry Collector's file-exporter JSONL (`aftertrace import`). Commands and flags: [docs/cli.md](docs/cli.md). JSON API: [docs/api.md](docs/api.md).

## Status

Early and pre-release. Aftertrace is built against Claude Code's documented telemetry (version 2.1.0 or later, with the enhanced telemetry beta). Some of that telemetry is in beta and may change. Expect rough edges, and please [open an issue](https://github.com/RahulKraken/aftertrace/issues) when something looks wrong.

## Docs

[Install](docs/install.md) · [Claude Code setup](docs/claude-code-setup.md) · [Behind a collector](docs/behind-a-collector.md) · [CLI](docs/cli.md) · [Findings](docs/findings.md) · [Writing rules](docs/writing-rules.md) · [Privacy](docs/privacy.md) · [Troubleshooting](docs/troubleshooting.md) · [Contributing](CONTRIBUTING.md)

## License

[Apache-2.0](LICENSE).
