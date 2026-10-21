# Aftertrace web UI

Static profiler UI for Claude Code traces. The Go binary embeds `web/dist` with `go:embed` (`web/fs.go`) and serves it on the UI port next to `/api`.

`web/dist` is a **build output**, not source. A stub `dist/index.html` is committed so `go test ./...` compiles without Node. Assets from a real build stay gitignored and are picked up from disk at `go build`.

## Develop (standalone, mock API)

```bash
cd web
npm install
npm run dev          # http://127.0.0.1:5173  — synthetic fixtures, no backend
```

The mock layer in `src/mock/` serves the same JSON contract as the Go API. The HTTP client lives in `src/lib/api.ts`. `VITE_USE_MOCK` defaults to on in `npm run dev` / `npm run build`.

`/?empty=1` or `#/empty` shows the first-run empty state.

## Embed in the Go binary

From the repo root:

```bash
cd web
npm ci
npm run build:embed   # VITE_USE_MOCK=0; writes web/dist (index.html + assets)
cd ..
go build -o aftertrace ./cmd/aftertrace
./aftertrace demo --db ./data/aftertrace.duckdb
./aftertrace serve --db ./data/aftertrace.duckdb
```

Open http://127.0.0.1:7311. Hash routes (`#/`, `#/trace/...`) need no server fallback; `GET /` is `dist/index.html`.

`npm run build` (mocks on) is only for static previews without the backend.

## Screenshots

```bash
npx playwright install chromium
npx playwright test
```

Writes light and dark PNGs to `web/screenshots/`.
