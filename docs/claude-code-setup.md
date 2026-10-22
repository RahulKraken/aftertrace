# Point Claude Code at Aftertrace

> [What happens to what Claude Code sends, with a figure →](how-it-works/receive.md)

The quickest way: run `aftertrace serve`, open http://127.0.0.1:7311 and go to **Connect**. It shows the settings block below with your server's real endpoints, has a button that copies it as a prompt Claude Code can apply for you, and confirms on the same page when the first data arrives. This page explains every variable in that block.

Variable names in this page are taken from [Claude Code monitoring](https://code.claude.com/docs/en/monitoring-usage). None are invented. Aftertrace does not configure Claude Code for you; you set the env and restart `claude`.

Put the env in `~/.claude/settings.json` or in the shell you start Claude Code from. Claude Code **ignores** OpenTelemetry exporter variables in a repository `.claude/settings.json` and `.claude/settings.local.json`. A repo file can still turn a signal **off** by setting an exporter to `none`.

Managed settings, if your organization has them, win. They can strip a developer-set endpoint at startup. If nothing arrives, check that first.

## Minimum that fills the waterfall

Aftertrace needs metrics, events (logs), and traces. Tracing is a Claude Code beta and is off until you set `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA`.

`~/.claude/settings.json`:

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

Same keys in the shell:

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_TRACES_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4317
export OTEL_LOG_TOOL_DETAILS=1
```

Then restart Claude Code. `ENABLE_ENHANCED_TELEMETRY_BETA=1` is also accepted as an alias of `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA`.

`OTEL_LOG_TOOL_DETAILS=1` is not content. It is how skill, agent, plugin and MCP names, Bash `full_command`, and file paths stay real instead of collapsing to `custom` / `third-party`. Several [findings](findings.md) need those names. Prompt text stays redacted at the source.

## HTTP instead of gRPC

Claude Code has **no default** `OTEL_EXPORTER_OTLP_PROTOCOL`. Set it. Aftertrace's HTTP receiver is `127.0.0.1:4318` and accepts `http/protobuf` and `http/json` on `/v1/traces`, `/v1/logs`, `/v1/metrics`.

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA": "1",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_TRACES_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://127.0.0.1:4318",
    "OTEL_LOG_TOOL_DETAILS": "1"
  }
}
```

The SDK appends `/v1/traces` (and logs, metrics) to that base URL. Do not put `/v1/traces` in `OTEL_EXPORTER_OTLP_ENDPOINT`. Per-signal overrides from the monitoring page, if you need them:

| Variable | Example |
| - | - |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | `http://127.0.0.1:4318/v1/traces` |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | `http://127.0.0.1:4318/v1/logs` |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | `http://127.0.0.1:4318/v1/metrics` |
| `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL` | `grpc`, `http/json`, `http/protobuf` |

Aftertrace does not require headers. Leave `OTEL_EXPORTER_OTLP_HEADERS` unset.

## What the traces beta does

`CLAUDE_CODE_ENABLE_TELEMETRY=1` alone exports metrics and, if `OTEL_LOGS_EXPORTER=otlp`, events. It does **not** export spans.

`CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` plus `OTEL_TRACES_EXPORTER=otlp` turns on distributed traces. Each user prompt becomes a `claude_code.interaction` root span. API calls, tools, permission waits and tool execution nest under it. That tree is the waterfall.

Without the beta flag, Aftertrace can still store metrics and events. Sessions and some findings will be thin or empty because they join on spans.

A separate pair, `ENABLE_BETA_TRACING_DETAILED=1` and `BETA_TRACING_ENDPOINT`, is **not** this flag. Detailed beta tracing redirects logs and traces to `BETA_TRACING_ENDPOINT` and is ignored in project/local settings. If that pair is set, data will not arrive at Aftertrace. Do not set it unless you mean to.

## Opting into content

Claude Code redacts user prompt text, assistant responses, tool input, and tool content by default. The gates below send that material to **your** OTLP endpoint, not to Anthropic. Aftertrace then drops the content keys listed in [privacy.md](privacy.md) unless you also pass `--store-content`.

| Variable | Default | What it sends | Cost of turning it on |
| - | - | - | - |
| `OTEL_LOG_TOOL_DETAILS=1` | off | Bash commands, file paths, skill / agent / MCP names, `tool_parameters` | Metadata about what ran. Can include secrets that were in a command line. Recommended for Aftertrace. |
| `OTEL_LOG_USER_PROMPTS=1` | off | Prompt text (`prompt`, `prompt_text`, span `user_prompt`) | The text you typed, in the store if you also pass `--store-content`. |
| `OTEL_LOG_ASSISTANT_RESPONSES=1` | off (falls back to `OTEL_LOG_USER_PROMPTS` when unset) | Assistant response text | Model output in events. Under detailed beta tracing, span `response.model_output` still follows `OTEL_LOG_USER_PROMPTS`. |
| `OTEL_LOG_TOOL_CONTENT=1` | off | `tool.output` span events: file text, Bash stdout/stderr, MCP / WebFetch / WebSearch results. Requires tracing. Truncated at 60 KB by default (`CLAUDE_CODE_OTEL_CONTENT_MAX_LENGTH`). | Source and command output in the store if you also pass `--store-content`. |
| `OTEL_LOG_RAW_API_BODIES=1` or `file:` | off | Full Anthropic Messages request/response JSON, entire conversation history. Implies consent to the other content flags. Ignored in project/local settings. | The whole transcript. Do not turn this on for Aftertrace. |

Aftertrace never recommends `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_TOOL_CONTENT`, or `OTEL_LOG_RAW_API_BODIES`. `--store-content` is a second gate: even if Claude Code sends those attributes, Aftertrace deletes them at ingest unless that flag is set. Identity keys are dropped either way.

## Check that data is arriving

1. `aftertrace serve` is running. The log line is `OTLP gRPC 127.0.0.1:4317` and `UI / API http://127.0.0.1:7311`.
2. Restart Claude Code after changing `~/.claude/settings.json`.
3. Start a session (metrics) and send a prompt (events and traces).
4. Open http://127.0.0.1:7311 or:

```bash
curl -s http://127.0.0.1:7311/api/sessions | head
curl -s http://127.0.0.1:7311/api/findings | head
```

The monitoring page says: a metrics setup should show `claude_code.session.count` when a session starts; a logs-only setup should show a `claude_code.user_prompt` event after you submit a prompt. In Aftertrace those land in `metric_points` and `events`.

If nothing arrives, start Claude Code with `claude --debug-file /tmp/claude-otel.log` and look for `[3P telemetry]` errors. Lines prefixed `[Anthropic telemetry]` are Anthropic's own operational telemetry and are unrelated.

Export intervals, if you want a faster first span while debugging (defaults from the monitoring page: metrics 60000 ms, logs 5000 ms, traces 5000 ms):

```bash
export OTEL_METRIC_EXPORT_INTERVAL=10000
export OTEL_LOGS_EXPORT_INTERVAL=5000
export OTEL_TRACES_EXPORT_INTERVAL=5000
```

The metrics interval variable is `OTEL_METRIC_EXPORT_INTERVAL` (no S).

Already have a collector in the middle: [behind-a-collector.md](behind-a-collector.md). Nothing on the Sessions page: [troubleshooting.md](troubleshooting.md#no-data-showing-up).
