# Stack options

Rahul's decision. This compares three options for the real build. The prototype (Python, DuckDB, vanilla JS) is throwaway and is not a vote for any of them.

Library facts verified 2026-10-21:

- **DuckDB Go binding.** The current module is `github.com/duckdb/duckdb-go/v2` (this repo pins `v2.10506.0`, DuckDB `v1.5.6`). `github.com/marcboeker/go-duckdb` moved there at `v2.5.0` and is deprecated. CGO is required. Pre-built static libs cover macOS amd64/arm64, Linux amd64/arm64, and Windows amd64 via `duckdb-go-bindings`. Cross-compilation must set `CGO_ENABLED=1` and a matching `CC`; Go disables CGO when GOOS/GOARCH differ otherwise.
- **OTLP receive.** The Collector's `otlpreceiver` pulls in the collector component graph (config, host, pdata, extensions) and current releases want a newer Go than this tree. Aftertrace uses `go.opentelemetry.io/proto/otlp` plus stdlib HTTP and `google.golang.org/grpc` handlers. Same protobuf/JSON as the file exporter, far less surface area.

## What the build needs

- One binary a user can `brew install` and run, with no Docker, Python or Node on the user's machine.
- An OTLP receiver for gRPC and HTTP (protobuf and JSON), plus import of the collector's file-exporter JSONL.
- Embedded DuckDB.
- A static web UI embedded in the binary.
- A rules format that people outside the core team can contribute to.
- An HTTP client for the opt-in Ask agent (Anthropic API, or a local OpenAI-compatible endpoint).

## Key point: rules should be SQL, whatever the host language

Every rule in the spec is one or two SQL queries plus a message template. If a rule is a YAML or TOML file holding SQL and templates, contributors write SQL and never touch the host language. That makes the host choice mostly about the receiver, the binary and the UI. A language-specific escape hatch (a Go, Rust or TS function) can exist for the rare rule that SQL can't express.

## Options

| | A. Go + DuckDB + embedded SPA | B. Rust + DuckDB + embedded SPA | C. TypeScript on Bun |
| - | - | - | - |
| Single binary | Yes. `go build` plus `embed.FS` for the UI. Cgo for DuckDB means per-platform builds (goreleaser with cross toolchains or native runners) | Yes. `cargo build` with `duckdb` crate's `bundled` feature plus `rust-embed`. Per-platform builds, slow C++ compile | `bun build --compile` gives one file, but DuckDB's native addon must ship beside it or be extracted at runtime. Least proven path |
| OTLP library maturity | Best. The OpenTelemetry Collector is Go. `pdata` and the OTLP receiver code are the reference implementation, including the JSON encoding the file exporter writes | Good. `opentelemetry-proto` crate with `tonic` (gRPC) and `prost`. You write the HTTP handlers yourself | Fair. `@opentelemetry/otlp-transformer` and proto packages exist for sending. Receiving needs hand-rolled gRPC and protobuf decoding |
| DuckDB bindings | `duckdb-go` (formerly `marcboeker/go-duckdb`), cgo, widely used, appender API for fast inserts | `duckdb-rs`, mature, appender API, bundled build | `@duckdb/node-api` (Neo). Works on Bun in most cases. Native addon packaging is the risk |
| Contributor friendliness | Good. Simple language, fast builds. Rules in SQL files | Lower. Long compile times and a steeper language for drive-by PRs. Rules in SQL files help | Highest familiarity for web developers. One language front to back |
| UI | Separate Vite + Preact or Solid app, built to static files and embedded | Same | Same app, same language as the server. Could share types with the API |
| Ask agent | `anthropic-sdk-go` exists. Plain HTTP also works | Plain HTTP with `reqwest`, no official SDK (check) | Official TS SDK, most examples |
| Binary size and memory | Moderate (DuckDB dominates, roughly 30 to 60 MB) | Similar | Larger (Bun runtime plus DuckDB) |

## Recommendation

Option A: Go receiver and API, embedded DuckDB, static Preact or Solid UI embedded in the binary, rules as SQL files. It gives the most mature OTLP receiving code (the collector's own), a single binary with a known release path, and a contributor story that rests on SQL rather than on Go.

Choose C if you value one language and fastest UI iteration over distribution risk. Prove the `bun build --compile` plus DuckDB packaging on macOS arm64 and Linux x64 first. Choose B only if you want Rust for its own sake. It costs contributor reach and build time for little gain here.

## Repo notes

The repo is `RahulKraken/aftertrace` and PRs target `main`.
