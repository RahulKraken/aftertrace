# Behind an OpenTelemetry Collector

> [How the receivers work, with a figure →](how-it-works/receive.md)

If Claude Code already exports to an OpenTelemetry Collector, do not point it at Aftertrace directly. Keep the collector as the only OTLP endpoint Claude Code sees, and fan out to Aftertrace from there.

Aftertrace's default ports are the same as a typical collector (`4317` gRPC, `4318` HTTP). One process can bind them. Move Aftertrace:

```bash
./aftertrace serve --db ./data/aftertrace.duckdb --grpc-port 14317 --http-port 14318 --ui-port 7311
```

Claude Code keeps talking to the collector on `4317` / `4318`. The collector's extra exporter talks to `127.0.0.1:14317`.

## Fan-out

An `otlp` exporter (gRPC) with TLS off, next to whatever you already export to. `file/` writers are optional; they are how you later run `aftertrace import`.

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:
  otlp/aftertrace:
    endpoint: 127.0.0.1:14317
    tls:
      insecure: true
  file/traces:
    path: /var/lib/aftertrace-import/traces.jsonl
    format: json
    append: true
  file/logs:
    path: /var/lib/aftertrace-import/logs.jsonl
    format: json
    append: true
  file/metrics:
    path: /var/lib/aftertrace-import/metrics.jsonl
    format: json
    append: true

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlp/aftertrace, file/traces]
    logs:
      receivers: [otlp]
      exporters: [otlp/aftertrace, file/logs]
    metrics:
      receivers: [otlp]
      exporters: [otlp/aftertrace, file/metrics]
```

Notes that matter:

- The gRPC `otlp` exporter `endpoint` is `host:port`, no `http://`.
- `tls.insecure: true` is required against Aftertrace. Aftertrace does not serve TLS.
- `file` `format` must stay `json` (newline-delimited OTLP JSON). `proto` and `compression: zstd` are not what `aftertrace import` reads.
- `append: true`. The file exporter defaults to truncate.
- Create `/var/lib/aftertrace-import` first, or set `create_directory: true` on each file exporter.
- Drop `file/*` from the pipelines if you only want live ingest.

HTTP instead of gRPC into Aftertrace:

```yaml
exporters:
  otlphttp/aftertrace:
    endpoint: http://127.0.0.1:14318
    tls:
      insecure: true
```

Use `otlphttp/aftertrace` in the pipelines in place of `otlp/aftertrace`.

## `aftertrace import`

`aftertrace import` reads a directory of JSONL:

| File | Payload |
| - | - |
| `traces.jsonl` | One `ExportTraceServiceRequest` / `TracesData` JSON object per line (`resourceSpans`) |
| `logs.jsonl` | One `ExportLogsServiceRequest` / `LogsData` JSON object per line (`resourceLogs`) |
| `metrics.jsonl` | One `ExportMetricsServiceRequest` / `MetricsData` JSON object per line (`resourceMetrics`) |

Missing files in an existing directory are skipped. A path that is not a directory is an error.

```bash
./aftertrace import --db /tmp/aftertrace-import.duckdb /tmp/aftertrace-import-test
```

That is the same parser `aftertrace demo` uses. Against a one-span synthetic `traces.jsonl` in that directory:

```
imported spans=1 span_events=0 events=0 metric_points=0
```

`--store-content` has the same meaning as on `serve`. After import, Aftertrace runs every rule and prints findings to stdout.

Live ingest (`serve`) and import share a DuckDB file. DuckDB takes an exclusive lock. Stop `serve` before `import` into the same `--db`, or import into another file.

Claude Code env vars still belong on the collector's receivers, not on Aftertrace. See [claude-code-setup.md](claude-code-setup.md).
