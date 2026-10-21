# Troubleshooting

## No data showing up

Aftertrace is up (you can open http://127.0.0.1:7311) but Sessions is empty.

1. Confirm the receivers. `aftertrace serve` logs `OTLP gRPC 127.0.0.1:4317` and `OTLP HTTP 127.0.0.1:4318`. If those ports failed to bind, serve exited.
2. Confirm Claude Code env. The keys must live in `~/.claude/settings.json` or the shell, not in a repo `.claude/settings.json`. Claude Code ignores exporter variables there. See [claude-code-setup.md](claude-code-setup.md).
3. Protocol must be set. Claude Code has no default `OTEL_EXPORTER_OTLP_PROTOCOL`. `grpc` goes to `:4317`. `http/protobuf` and `http/json` go to `:4318` with `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` (no `/v1/traces` suffix).
4. Traces need the beta flag. `CLAUDE_CODE_ENABLE_TELEMETRY=1` alone is metrics (and logs if enabled). Waterfalls need `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` and `OTEL_TRACES_EXPORTER=otlp`.
5. Restart Claude Code after changing settings. Then send a prompt; metrics can take up to `OTEL_METRIC_EXPORT_INTERVAL` (default 60s).
6. Check `/api/sessions`. An empty array `[]` means ingest has not stored a `session.id`.
7. `claude --debug-file /tmp/claude-otel.log`. Failures from your exporter are `[3P telemetry]`. `[Anthropic telemetry]` is unrelated.
8. Managed settings can strip your endpoint. Detailed beta tracing (`ENABLE_BETA_TRACING_DETAILED` + `BETA_TRACING_ENDPOINT`) redirects logs and traces away from the OTLP exporters. Unset that pair.
9. Behind a collector, Claude Code must still reach the collector, and the collector must export to Aftertrace's ports. [behind-a-collector.md](behind-a-collector.md).

To prove the receivers without Claude Code, `aftertrace demo` or `aftertrace import <dir>` of synthetic JSONL. An OTLP client with the same `OTEL_EXPORTER_OTLP_*` values also works: `http/protobuf` to `http://127.0.0.1:4318` posted traces to `/v1/traces` and they showed up under `/api/sql`.

## Port in use

```
otlp grpc: listen tcp 127.0.0.1:4317: bind: address already in use
```

Something else (another `aftertrace serve`, a collector) holds 4317, 4318, or 7311. Pick other ports:

```bash
./aftertrace serve --db ./data/aftertrace.duckdb --grpc-port 14317 --http-port 14318 --ui-port 7312
```

Point Claude Code or the collector at the new gRPC/HTTP ports.

## DuckDB lock

```
open db: ... Could not set lock on file "./data/aftertrace.duckdb": Conflicting lock is held in ... (PID ...)
```

Only one process opens a given DuckDB file. Stop the `serve` that holds it before `demo` or `import` on the same `--db`.

## `aftertrace import` path

A directory that does not exist exits 1:

```
import: stat /tmp/does-not-exist-aftertrace: no such file or directory
```

An existing empty directory imports zero rows and exits 0. Check that `traces.jsonl` / `logs.jsonl` / `metrics.jsonl` are in that directory, JSONL, uncompressed. `format: proto` and zstd from the file exporter will not parse.

## CGO build errors

```
imports github.com/duckdb/duckdb-go-bindings/lib/linux-amd64: build constraints exclude all Go files in ...
```

`CGO_ENABLED` is 0, or there is no C compiler, or you cross-compiled. `go env CGO_ENABLED` must print `1`. Install a C toolchain ([install.md](install.md)). Do not set `CGO_ENABLED=0`. Cross-compilation needs `CGO_ENABLED=1` and a `CC` for the target; the prebuilt DuckDB libs exist only for darwin/linux amd64+arm64 and windows-amd64.

On macOS, `xcode-select --install`. On Debian/Ubuntu, `build-essential`. On Windows, MinGW-w64 gcc.

## Empty UI (stub page)

The page says "Aftertrace UI is not in this binary yet" and links `/api/sessions`.

`web/dist/index.html` is a committed stub so `go test` compiles without Node. `go:embed` takes whatever is on disk at `go build`. You need:

```bash
cd web && npm ci && npm run build:embed && cd ..
go build -o aftertrace ./cmd/aftertrace
```

`npm run build` (mocks on) is the wrong script for the binary. `build:embed` sets `VITE_USE_MOCK=0`. Rebuild after any UI change; embed is not live-reload.

`npm run dev` is a different loop: http://127.0.0.1:5173 with mock fixtures, no Go process. [CONTRIBUTING.md](../CONTRIBUTING.md).

## Findings missing after demo

`aftertrace demo` prints them on stdout. The UI reads `/api/findings` from whatever `--db` `serve` opened. Serve the same path:

```bash
./aftertrace demo --db ./data/aftertrace.duckdb
./aftertrace serve --db ./data/aftertrace.duckdb
```

Default `--db` is `$HOME/.aftertrace/aftertrace.duckdb`, not `./data/aftertrace.duckdb`.

## Skill / MCP names are `custom`

Set `OTEL_LOG_TOOL_DETAILS=1`. Without it Claude Code redacts those names. Aftertrace stores what it is sent.

## Prompt text in the UI

It should not be there. If it is, you passed `--store-content` and Claude Code has `OTEL_LOG_USER_PROMPTS=1`. Drop the flag and ingest new data; existing rows stay until you delete the DB ([privacy.md](privacy.md#how-to-delete-it)).
