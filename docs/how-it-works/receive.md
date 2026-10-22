# Receiving

Aftertrace receives standard OpenTelemetry (OTLP) on two ports. Each export it receives is flattened into one row per span, log record or metric point, redacted, and written to the store in one transaction.

<!-- figure:receive -->
![Fig 2, Receiving: a sorting bench. Three transmitters are cabled into an inlet box with a gRPC socket and an HTTP socket. Each lane runs under a size gauge set at 32 MB, and the HTTP lane passes a knob that turns to protobuf or JSON. A paper tray of .jsonl files feeds a third lane. All lanes end in an unpacker whose lid shows nested trays. Rows leave it under a comb, run down a sorting channel into four bins on one tray with a plunger, and a cable runs to a small cabinet, the store.](../images/figure-receive.png)

Point at a part to read it. **O** sends an export over the size limit. **I** runs an import.

## The two receivers

| | gRPC | HTTP |
|---|---|---|
| Address | `127.0.0.1:4317` | `127.0.0.1:4318` |
| What it takes | OTLP `TraceService`, `LogsService` and `MetricsService` `Export` calls | `POST /v1/traces`, `POST /v1/logs`, `POST /v1/metrics` |
| Body | protobuf | protobuf, or JSON (see below) |
| Size limit | 32 MB per message | 32 MB per request body |
| Change it with | `--grpc-port`, `--listen` | `--http-port`, `--listen` |

Both listen on `127.0.0.1` by default, so only programs on your machine can reach them. `--listen 0.0.0.0` accepts exports from other machines (team mode); see [Behind a collector](../behind-a-collector.md). No headers or tokens are needed.

## What happens to one request

1. **Arrive.** An export reaches one of the ports. On HTTP, anything but `POST` gets `405 Method Not Allowed`. A client has 10 seconds to send its headers.
2. **Size check.** A body over 32 MB is refused before it is decoded. HTTP answers `400` with `http: request body too large`; gRPC answers `RESOURCE_EXHAUSTED`. Nothing from it is stored.
3. **Decode.** gRPC is always protobuf. On HTTP, a `Content-Type` containing `json` means OTLP/JSON, anything else means protobuf. With no `Content-Type`, a body that starts with `{` is read as JSON. OTLP/JSON trace and span ids are hex strings, and they are kept as the same hex in the store.
4. **Flatten.** An export is nested: resources (one per process, with `service.name` and the like) hold scopes, and scopes hold the records. Each record becomes one row, with its resource's attributes copied onto it. The session id comes from the record's `session.id`, or its resource's when the record has none.
5. **Redact.** Before any row exists, identity keys are deleted from the resource, the record and every span event. Content keys are deleted too unless the server runs with `--store-content`. See [Redaction](redaction.md).
6. **Write.** All the rows from one export are written in one transaction: all of them or none. The sender then gets `200` (HTTP) or an empty `ExportResponse` (gRPC). If the write fails, HTTP answers `400` with the error and gRPC returns it.

A span sent twice replaces itself rather than counting twice. Log records and metric points have no natural key, so a resend adds them again. See [The store](store.md).

## What each signal becomes

| Signal | Endpoint | Rows | Notes |
|---|---|---|---|
| Traces | `/v1/traces` | `spans`, `span_events` | One `spans` row per span, keyed by trace id and span id. Each span event becomes a `span_events` row. Error status sets `is_error`. |
| Logs | `/v1/logs` | `events` | The event name is the `event.name` attribute, else the log body, with a leading `claude_code.` removed. `prompt.id`, `request_id` and `tool_use_id` get their own columns. |
| Metrics | `/v1/metrics` | `metric_points` | Sum and gauge points only. Histogram and summary points are not stored. Integer values are stored as numbers like any other. |

## Pointing a source at it

Claude Code, over gRPC (the full block, with the trace beta, is in [Connect Claude Code](../claude-code-setup.md)):

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_TRACES_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4317
```

For HTTP, use `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` (or `http/json`) and `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318`. The SDK adds `/v1/traces`, `/v1/logs` and `/v1/metrics` itself, so leave them out of the endpoint. Any other OpenTelemetry SDK works the same way; see [Apps and agents](../apps.md).

## Try it by hand

One log record as OTLP/JSON:

```bash
curl -i http://127.0.0.1:4318/v1/logs \
  -H 'Content-Type: application/json' \
  -d '{"resourceLogs":[{"resource":{"attributes":[
        {"key":"service.name","value":{"stringValue":"curl-test"}}]},
      "scopeLogs":[{"logRecords":[{
        "timeUnixNano":"1760000000000000000",
        "body":{"stringValue":"hello"},
        "attributes":[
          {"key":"session.id","value":{"stringValue":"demo-1"}},
          {"key":"user.email","value":{"stringValue":"a@b.c"}}]}]}]}]}'
```

It answers `200`, and the store gets one `events` row: name `hello`, session `demo-1`, attributes `{"session.id": "demo-1"}`, resource `{"service.name": "curl-test"}`. `user.email` is gone: it is an identity key.

## Importing files

`aftertrace import <dir>` reads OTLP/JSON from files instead of the network. It looks for `traces.jsonl`, `logs.jsonl` and `metrics.jsonl` in that directory (each one optional), one export request per line. Each line goes through the same flatten, redact and write steps as a network export. A line that is not valid JSON stops the import with its file and line number. `--db` and `--store-content` work as they do for `serve`. When it finishes it prints how many rows it added and runs the rules once.

`aftertrace demo` uses the same path: it writes synthetic `.jsonl` files to a temporary directory and imports them.

## When nothing arrives

- **Nothing at all.** Check the protocol and the port agree: `grpc` with `4317`, `http/protobuf` or `http/json` with `4318`. Claude Code has no default protocol, so set one.
- **Metrics and events but no sessions.** Claude Code only sends spans with its trace beta on; see [Connect Claude Code](../claude-code-setup.md#what-the-traces-beta-does).
- **From another machine.** The receivers only listen on `127.0.0.1` unless you pass `--listen`.

More in [Troubleshooting](../troubleshooting.md).

Next: [Redaction](redaction.md), what is dropped on the way in.
