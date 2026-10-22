# Contributing

PRs target `main`. Aftertrace is licensed under [Apache-2.0](LICENSE); by contributing you agree your contribution is licensed the same way.

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

For live data with hot reload, run `aftertrace serve` (or `aftertrace demo` first) and then `npm run dev:live`: http://127.0.0.1:5199 proxies `/api` to the server on :7311. Testing against your own data is how most real bugs here have been found.

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

## Website

`site/` builds the website: the landing page (`site/public`), every doc in `docs/` rendered with a sidebar, and the mock UI as a live demo under `/demo/`. `.github/workflows/pages.yml` publishes it on every push to `main`.

```bash
cd web && npm ci && cd ../site && npm ci && cd ..
node site/build.mjs        # writes site/dist
python3 -m http.server 4180 -d site/dist
```

Docs navigation lives in `NAV` in `site/build.mjs`; add new docs there.

## Releases

Push a `v*` tag. `.github/workflows/release.yml` builds macOS (arm64, amd64) and Linux (amd64, arm64) archives, writes `checksums.txt`, and publishes a release with notes from the matching `CHANGELOG.md` section. Add the section first.

There is no Homebrew tap yet. `sh scripts/homebrew-formula.sh vX.Y.Z` prints `Formula/aftertrace.rb` for a published release, with the four archive URLs and their sha256 from its `checksums.txt` (pass a local `checksums.txt` as the second argument to skip the download). Committing that file to a repo named `homebrew-<name>` makes `brew install <owner>/<name>/aftertrace` work; regenerate it on each tag.

## Tests

```bash
go test ./...
cd web && npm run lint && npx playwright test
```

CI also runs a smoke test against the real binary on demo data (`web/e2e-live`, `playwright.live.config.ts`). Locally: build the embedded UI and the binary, `aftertrace demo`, `aftertrace serve`, then `npx playwright test -c playwright.live.config.ts` in `web/` (set `AFTERTRACE_URL` if you use another port).

If you change the demo data or an API the mock build mirrors, regenerate the generated fixtures with `sh web/scripts/gen-app-fixtures.sh`.

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
- No real user data. No badges for things that do not exist.

User-facing docs live in `docs/` and [README.md](README.md). `docs/spec.md` is the product spec, not a getting-started guide. JSON API: [docs/api.md](docs/api.md).
