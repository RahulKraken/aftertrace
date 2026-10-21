# Security

Aftertrace stores your Claude Code telemetry on your machine and promises that it stays there. If you find a way around that promise, please report it privately.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: the **Security** tab of this repository, then **Report a vulnerability**. Do not open a public issue.

Include what you ran, what you expected, and what happened. A minimal reproduction with synthetic data (`aftertrace demo`) is ideal. Never attach real traces.

You should hear back within a few days. Fixes ship in the next release, with credit in the changelog unless you ask otherwise.

## In scope

- The OTLP receivers (`:4317`, `:4318`) and the UI and JSON API (`:7311`).
- Redaction at ingest: content or identity attributes that reach the store when they should be dropped. See [docs/privacy.md](docs/privacy.md).
- The read-only SQL sandbox behind `/api/sql` and the query builder: reading files, writing data, or reaching the network.
- Anything that sends data off the machine.

## Supported versions

Aftertrace is pre-release. Only the latest `main` is supported.
