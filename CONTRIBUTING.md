# Contributing

PRs target `main`. There is no LICENSE file yet (License: TBD). Do not add one.

Do not commit real traces, emails, or filesystem paths. Synthetic data only (`aftertrace demo`, `internal/demo`, `web/src/mock/fixtures`).

## Dev loop

Two UIs. Do not mix them up.

### UI against mocks (no Go)

```bash
cd web
npm ci
npm run dev
```

http://127.0.0.1:5173. `VITE_USE_MOCK` defaults on. Fixtures in `web/src/mock/` implement the same JSON as `/api`. `#/empty` is the first-run screen.

`npm run lint` is oxlint. `npx playwright test` drives the mock app (see `web/playwright.config.ts`).

There is no Vite proxy to the Go API, and the API does not send CORS headers. Live data is the embedded binary.

### Embedded binary (real `/api`)

```bash
cd web && npm ci && npm run build:embed && cd ..
go test ./...
go build -o aftertrace ./cmd/aftertrace
./aftertrace demo --db ./data/aftertrace.duckdb
./aftertrace serve --db ./data/aftertrace.duckdb
```

http://127.0.0.1:7311. `npm run build:embed` writes `web/dist` with `VITE_USE_MOCK=0`. `go:embed` in `web/fs.go` picks that directory up at `go build`. Skip `build:embed` and you ship the stub page; see [docs/troubleshooting.md](docs/troubleshooting.md#empty-ui-stub-page).

Rebuild `web/dist` and the Go binary after UI changes. `web/dist/**` is gitignored except the stub `index.html`.

## Tests

```bash
go test ./...
cd web && npm run lint
```

`go test ./internal/` loads demo JSONL into DuckDB and checks the API, redaction, and that every shipped rule fires. `go test ./internal/rules` checks `rules/` matches `internal/rules/files/`. `go test ./internal/otlp` hits the gRPC and HTTP receivers.

CGO is required. `CGO_ENABLED=0` does not compile.

## Rules

SQL files. Format, views, and a worked example: [docs/writing-rules.md](docs/writing-rules.md).

Edit `rules/<id>.sql` and copy the same bytes to `internal/rules/files/<id>.sql`. The embed is the copy under `internal/`. A PR that changes only one tree fails `TestRepoRulesMatchEmbedded`.

If the rule should fire on `aftertrace demo`, add a scenario in `internal/demo` and the id to `TestRulesFireOnIntendedScenariosAndStaySilentOnCleanSession`. Leave the clean haiku session uncited.

## PR expectations

- `go test ./...` passes.
- UI changes: `npm run build:embed` succeeds locally, `npm run lint` is clean. Playwright if you touched layout the e2e suite covers.
- New flags: `docs/cli.md` and `aftertrace <cmd> -h` agree.
- New env vars: names copied from [Claude Code monitoring](https://code.claude.com/docs/en/monitoring-usage), not invented.
- Docs use relative links. Commands in fenced blocks have been run.
- No LICENSE file. No real user data. No badges for things that do not exist.

User-facing docs live in `docs/` and [README.md](README.md). `docs/spec.md` is the product spec, not a getting-started guide. JSON API: [docs/api.md](docs/api.md).
