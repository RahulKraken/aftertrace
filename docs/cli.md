# CLI

`aftertrace` has three commands. Unknown commands and a missing command print usage and exit 2.

```
Aftertrace — local profiler for Claude Code.

Usage:
  aftertrace serve   [--db PATH] [--listen HOST] [--grpc-port N] [--http-port N] [--ui-port N] [--store-content]
  aftertrace import  [--db PATH] [--store-content] <dir>
  aftertrace demo    [--db PATH]
```

`help`, `-h`, and `--help` print the same text. Each command also accepts `-h` for its flags. Go's flag package accepts both `-db` and `--db`.

Default `--db` is `$HOME/.aftertrace/aftertrace.duckdb`. If `$HOME` cannot be resolved, it is `aftertrace.duckdb` in the current directory. The parent directory is created if needed.

## `aftertrace serve`

Start the OTLP receivers and the UI / JSON API. Blocks until SIGINT or SIGTERM.

```
Usage of serve:
  -db string
    	DuckDB file (default "$HOME/.aftertrace/aftertrace.duckdb")
  -grpc-port int
    	OTLP gRPC port (default 4317)
  -http-port int
    	OTLP HTTP port (default 4318)
  -listen string
    	bind address (use 0.0.0.0 for team mode) (default "127.0.0.1")
  -store-content
    	keep prompt/response/tool content attributes
  -ui-port int
    	UI and JSON API port (default 7311)
```

```bash
./aftertrace serve --db ./data/aftertrace.duckdb
```

```
Aftertrace
  db          ./data/aftertrace.duckdb  (493 spans)
  OTLP gRPC   127.0.0.1:4317
  OTLP HTTP   127.0.0.1:4318
  UI / API    http://127.0.0.1:7311
redact=on store_content=false  (no telemetry)
```

| Flag | Default | Notes |
| - | - | - |
| `--db` | `$HOME/.aftertrace/aftertrace.duckdb` | DuckDB file. Exclusive lock; only one process. |
| `--listen` | `127.0.0.1` | Bind host for gRPC, HTTP, and UI. `0.0.0.0` accepts remote OTLP. |
| `--grpc-port` | `4317` | OTLP gRPC (traces, logs, metrics). |
| `--http-port` | `4318` | OTLP HTTP. `POST /v1/traces`, `/v1/logs`, `/v1/metrics`. JSON or protobuf. |
| `--ui-port` | `7311` | UI and `/api`. |
| `--store-content` | off | Keep the content keys in [privacy.md](privacy.md). Identity keys are still dropped. |

A bound port exits 1:

```
otlp grpc: listen tcp 127.0.0.1:4317: bind: address already in use
```

## `aftertrace import`

Read a collector file-exporter directory into DuckDB, then run every rule and print findings. Exits when it is done.

```
Usage of import:
  -db string
    	DuckDB file (default "$HOME/.aftertrace/aftertrace.duckdb")
  -store-content
    	keep prompt/response/tool content attributes
```

Positional: exactly one directory. Missing dir or extra args exit 2 from the flag parser / usage line:

```
usage: aftertrace import [--db PATH] [--store-content] <dir>
```

A path that does not exist exits 1:

```
import: stat /tmp/does-not-exist-aftertrace: no such file or directory
```

```bash
./aftertrace import --db ./data/aftertrace.duckdb /path/to/jsonl
```

Expected files, all optional if the directory exists: `traces.jsonl`, `logs.jsonl`, `metrics.jsonl`. Format: [behind-a-collector.md](behind-a-collector.md#aftertrace-import).

`--store-content` is the same ingest gate as on `serve`.

## `aftertrace demo`

Generate six synthetic Claude Code sessions, import them, print counts and findings. No OTLP ports. `--store-content` is not a flag; demo ingest always redacts.

```
Usage of demo:
  -db string
    	DuckDB file (default "$HOME/.aftertrace/aftertrace.duckdb")
```

```bash
./aftertrace demo --db ./data/aftertrace.duckdb
```

```
loaded 6 synthetic sessions into ./data/aftertrace.duckdb
spans=493 span_events=169 events=549 metric_points=764  (aftertrace.synthetic=true)
12 findings
[high] retry.exhausted  An API request gave up after 11 attempts
...
run: aftertrace serve --db ./data/aftertrace.duckdb
```

Every record has resource attribute `aftertrace.synthetic=true`. The generator is `internal/demo`. All ten shipped rules fire on this data; the clean haiku session is left uncited.

Demo and serve cannot share a DB at the same time:

```
open db: ... Could not set lock on file "./data/aftertrace.duckdb": Conflicting lock is held ...
```

Stop `serve`, run `demo`, start `serve` again.

There is no `init`, `purge`, or `version` command.
