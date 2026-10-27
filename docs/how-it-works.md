# How it works

Aftertrace is one binary on your machine. Telemetry comes in, private fields are dropped, the rest goes into one DuckDB file, and SQL rules turn that file into findings you can read in the browser. Nothing leaves your machine unless you switch on Ask.

<!-- figure:system -->
![Fig 1, How Aftertrace works: an instrument bench. Sources on the left feed a junction box, light runs along a trough through a sieve into a cabinet of drawers, a carriage of rule templates reads the drawers, finding cards land in a tray, and a screen and a locked outbox sit at the right.](images/figure-system.png)

Point at a station to read it, and click it to open its page. With the figure focused, the arrow keys step through the stations and Enter opens one. **C** flips the content lever and **A** unlocks the outbox.

## The path of one span

Here is what happens when Claude Code finishes one API request.

1. **Claude Code sends it, or Aftertrace reads it from disk.** Live, the OpenTelemetry exporter batches the `claude_code.llm_request` span and sends it to `127.0.0.1:4317` over gRPC or `:4318` over HTTP. On first launch, session JSONL already under `~/.claude/projects` is imported as the same kind of rows, without prompt text. [Receiving →](how-it-works/receive.md) · [Local history →](claude-code-setup.md#local-session-history)
2. **The receiver decodes it.** The batch is OTLP protobuf or JSON. It is turned into rows: traces become `spans` and `span_events`, logs become `events`, metrics become `metric_points`. [Receiving →](how-it-works/receive.md)
3. **Redaction strips it.** Account identifiers such as `user.email` are always deleted. Prompt, response and tool content is deleted unless you started with `--store-content`. Token counts, durations, model names and costs stay. [Redaction →](how-it-works/redaction.md)
4. **The store keeps it.** The rows go into `~/.aftertrace/aftertrace.duckdb` in one write. If the same span arrives twice, it replaces itself. Views such as `llm` and `tools` turn the JSON attributes into columns. [The store →](how-it-works/store.md)
5. **Rules read it.** Thirteen SQL rules run against the store each time the app asks for findings, with results reused for up to 10 seconds. Each returns findings with a severity, an impact and the spans that prove it. [Findings →](how-it-works/findings.md)
6. **You read it.** The app on `127.0.0.1:7311` shows the turn as a story: model thinking, tools running, time spent waiting on you. [Reading a turn →](how-it-works/turn.md)
7. **Ask, if you want it.** Ask is off by default. With `--ask` and an Anthropic API key, a question in plain English is answered by Claude. It writes read-only SQL that runs here, and only the schema and trimmed result rows are sent to it. [Ask →](how-it-works/ask.md)

## What runs where

Everything above is one process, `aftertrace serve`. It opens three ports and one file.

| Part | Default | Change it with | Page |
|---|---|---|---|
| OTLP gRPC | `127.0.0.1:4317` | `--grpc-port`, `--listen` | [Receiving](how-it-works/receive.md) |
| OTLP HTTP | `127.0.0.1:4318` | `--http-port`, `--listen` | [Receiving](how-it-works/receive.md) |
| Identity keys | 6, always dropped | cannot be kept | [Redaction](how-it-works/redaction.md) |
| Content keys | 41 keys and 4 prefixes, dropped | `--store-content` | [Redaction](how-it-works/redaction.md) |
| Database | `~/.aftertrace/aftertrace.duckdb` | `--db` | [The store](how-it-works/store.md) |
| Tables | `spans`, `span_events`, `events`, `metric_points` | | [The store](how-it-works/store.md) |
| Rules | 13, compiled into the binary | [Writing rules](writing-rules.md) | [Findings](how-it-works/findings.md) |
| UI and JSON API | `127.0.0.1:7311` | `--ui-port`, `--listen` | [Reading a turn](how-it-works/turn.md) |
| Ask | off | `--ask` and `ANTHROPIC_API_KEY` | [Ask](how-it-works/ask.md) |

To start sending data, see [Install](install.md) and [Connect Claude Code](claude-code-setup.md).
