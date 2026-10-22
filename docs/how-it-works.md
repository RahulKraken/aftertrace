# How it works

Aftertrace is one binary on your machine. Telemetry comes in, private fields are dropped, the rest goes into one DuckDB file, and SQL rules turn that file into findings you can read in the browser.

<!-- figure:system -->
![Fig 1, How Aftertrace works: an instrument bench. Sources on the left feed a junction box, light runs along a trough through a sieve into a cabinet of drawers, a carriage of rule templates reads the drawers, finding cards land in a tray, and a screen and a locked outbox sit at the right.](images/figure-system.png)

Point at a station in the figure to read it. **C** flips the content lever, **A** unlocks the outbox.

## The stations

1. **Sources.** Claude Code, the Claude Agent SDK and your own apps send OpenTelemetry: traces, logs and metrics. Nothing is installed in them; you set a few environment variables ([Connect Claude Code](claude-code-setup.md), [Apps and agents](apps.md)).
2. **Receivers.** OTLP over gRPC on port 4317 and HTTP on 4318, bound to `127.0.0.1` unless you pass `--listen`.
3. **Redaction.** Before anything is written, account identifiers are deleted every time, and prompt, response and tool content is deleted unless you run with `--store-content`. This is the content lever in the figure. The full lists are in [Privacy](privacy.md).
4. **Store.** What is left goes into one DuckDB file, `~/.aftertrace/aftertrace.duckdb` by default, in four tables. A span sent twice replaces itself instead of counting twice.
5. **Findings.** Thirteen SQL rules read the store and return findings, each with evidence and an impact, mostly in dollars or seconds ([Findings](findings.md), [Writing rules](writing-rules.md)).
6. **UI and API.** The app and its JSON API on `127.0.0.1:7311` read the same file ([JSON API](api.md)).
7. **Ask.** Off by default, so nothing leaves your machine. With `--ask` and `ANTHROPIC_API_KEY` set, a question in plain English sends the schema and query results to the Anthropic API, never raw traces.

## Reference

| Part | Default | Change it with |
|---|---|---|
| OTLP gRPC | `127.0.0.1:4317` | `--grpc-port`, `--listen` |
| OTLP HTTP | `127.0.0.1:4318` | `--http-port`, `--listen` |
| UI and JSON API | `127.0.0.1:7311` | `--ui-port`, `--listen` |
| Identity keys | 6, always dropped | cannot be kept |
| Content keys | 40 keys and 4 prefixes, dropped | `--store-content` |
| Database | `~/.aftertrace/aftertrace.duckdb` | `--db` |
| Tables | `spans`, `span_events`, `events`, `metric_points` | [Schema notes](schema-notes.md) |
| Rules | 13, compiled into the binary | [Writing rules](writing-rules.md) |
| Ask | off | `--ask` and `ANTHROPIC_API_KEY` |
