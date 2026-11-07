# Install

Aftertrace is one binary with an embedded DuckDB and an embedded React UI. Nothing else to run.

## Download for Mac

**[Download for Mac](https://github.com/RahulKraken/aftertrace/releases/latest/download/Aftertrace-mac.dmg)** (Apple silicon) — Open the DMG, drag Aftertrace to Applications. Double-click to open. If macOS says the developer cannot be verified, right-click Aftertrace, choose Open, then Open again (only while builds are unsigned).

[Windows](https://github.com/RahulKraken/aftertrace/releases/latest/download/Aftertrace-win.exe) · [Linux AppImage](https://github.com/RahulKraken/aftertrace/releases/latest/download/Aftertrace-linux.AppImage) · [Linux .deb](https://github.com/RahulKraken/aftertrace/releases/latest/download/Aftertrace-linux.deb)

The app lives in the menu bar (tray on Windows and Linux), starts the same engine, and opens http://127.0.0.1:7311. While the dashboard is open it is a normal Mac app (Dock and Cmd+Tab). Closing the window keeps the menu bar and the engine; it does not quit. Start at login is off until you opt in from the first-launch screen or the menu. The menu extra is a compact square “trace corner” glyph; click it for the current session, today’s spend, one finding, and utilities (including Check for updates / Restart to update). Update checks hit GitHub Releases only — not usage telemetry. See [desktop-shell.md](desktop-shell.md).

The consumer Mac download is Apple silicon, signed and notarized when Apple secrets are present, and unsigned otherwise. [Signing](signing.md).

## CLI (macOS and Linux)

```bash
curl -fsSL https://rahulkraken.github.io/aftertrace/install.sh | sh
```

That is the whole CLI install. The script picks the archive for your OS and CPU (macOS arm64 or Intel, Linux amd64 or arm64) from the [latest release](https://github.com/RahulKraken/aftertrace/releases/latest), checks it against `checksums.txt`, installs `aftertrace` to `/usr/local/bin` if you can write there, otherwise `~/.local/bin`, starts the login service (a LaunchAgent on macOS, a systemd user unit on Linux), waits until http://127.0.0.1:7311 answers, and opens it in your browser. First launch imports usage from Claude Code's local session files (`~/.claude/projects`) if any are there, then offers the live OpenTelemetry export as an optional next step. See [Connect Claude Code](claude-code-setup.md).

`AFTERTRACE_VERSION=v0.1.0` pins a version; `AFTERTRACE_BIN=/some/dir` picks the directory. CI and headless installs can skip the service and the browser:

```bash
curl -fsSL https://rahulkraken.github.io/aftertrace/install.sh | sh -s -- --no-service --no-open
# or: curl -fsSL ... | AFTERTRACE_NO_SERVICE=1 AFTERTRACE_NO_OPEN=1 sh
```

Re-running upgrades the binary and restarts the service. If the install directory is not on your `PATH`, the script prints the `export PATH=...` line to add it. Read [`install.sh`](../install.sh) first if you prefer; it is short.

Or download an archive from the releases page, untar it, and put `aftertrace` on your `PATH`, then `aftertrace service install` (or `aftertrace serve`) and open http://127.0.0.1:7311.

Windows is not in the curl installer yet. Use the [Windows download](https://github.com/RahulKraken/aftertrace/releases/latest/download/Aftertrace-win.exe) above. Building the Go binary from source still needs a CGO toolchain such as MSYS2 MinGW (DuckDB ships a `windows-amd64` library).

## Run it at login

The curl installer already runs `aftertrace service install`. `aftertrace serve` stops when you close the terminal, log out or restart; the login service starts at login, restarts if it exits, and appends its output to `~/.aftertrace/serve.log`. Run `service install` yourself to change flags, or if you installed with `--no-service`.

Pass the same flags you give `serve`:

```bash
aftertrace service install --store-content
```

It prints the file it writes and every command it runs. `--dry-run` prints them and stops. If an `aftertrace serve` you started by hand is still running, stop it first; install refuses while the ports are taken.

```bash
aftertrace service status
aftertrace service uninstall
```

Run `install` again to change flags or to pick up a new binary after an upgrade. Details, the exact files, and Linux's `loginctl enable-linger`: [cli.md](cli.md#aftertrace-service).

## Build from source

### Prerequisites

| Tool | Why | Version used here |
| - | - | - |
| Go | Binary, tests, DuckDB driver | **1.24.0** (`go 1.24.0` in [`go.mod`](../go.mod)). `go version` printed `go version go1.24.0 linux/amd64`. |
| C toolchain | DuckDB is linked through CGO (`github.com/duckdb/duckdb-go/v2`) | `gcc` 13 on Linux. `go env CGO_ENABLED` must be `1`. |
| Node.js | Vite production build written to `web/dist` and picked up by `go:embed` | Node **22** (`v22.23.3` here). Vite 8 also accepts 20.19+. |

The Go module vendors prebuilt DuckDB libraries for `darwin-amd64`, `darwin-arm64`, `linux-amd64`, `linux-arm64`, and `windows-amd64`. You still need CGO to link them. Other GOOS/GOARCH pairs will not build.

### Build

From the repo root. `npm run build:embed` is required for a UI that talks to `/api`. Without it, `go build` embeds the stub `web/dist/index.html`.

```bash
cd web && npm ci && npm run build:embed && cd ..
go test ./...
go build -o aftertrace ./cmd/aftertrace
```

`go test ./...` compiles against the stub if you have not built the UI. Tests do not need Node. The binary you will actually open does.

Then:

```bash
./aftertrace demo --db ./data/aftertrace.duckdb
./aftertrace serve --db ./data/aftertrace.duckdb
```

Open http://127.0.0.1:7311. Default DB path if you omit `--db` is `$HOME/.aftertrace/aftertrace.duckdb`.

### macOS

```bash
xcode-select --install   # clang, once
```

Apple Silicon and Intel both have prebuilt DuckDB libs. Then the build block above.

### Linux

A C compiler is enough. On Debian/Ubuntu:

```bash
sudo apt-get install -y build-essential
```

Then the build block above. Confirmed on linux/amd64 with `gcc` 13.3.0.

### Windows

Need a gcc that CGO can invoke (MinGW-w64 or llvm-mingw), 64-bit only (`windows-amd64`). In a Developer Command Prompt or Git Bash:

```bat
set CGO_ENABLED=1
cd web
npm ci
npm run build:embed
cd ..
go test ./...
go build -o aftertrace.exe ./cmd/aftertrace
```

The resulting `aftertrace.exe` is not relocatable from another OS. Build on Windows.

## Cross-compilation

Do not `GOOS=... GOARCH=... go build` from a different OS and expect it to work.

Go turns CGO off when `GOOS`/`GOARCH` differ from the host, unless you set `CGO_ENABLED=1` and a matching `CC`. The DuckDB bindings are C archives for one OS/arch. A Linux host cannot produce a macOS binary without a macOS C toolchain and the darwin library; the reverse is the same.

`CGO_ENABLED=0 go build ./cmd/aftertrace` fails with:

```
imports github.com/duckdb/duckdb-go-bindings/lib/linux-amd64: build constraints exclude all Go files in .../linux-amd64@v0.10506.0
```

Build on the target OS, or use a CI matrix with a C cross-compiler per target. There is no Docker path in this repo.

## If the UI is empty

You forgot `npm run build:embed`. See [troubleshooting.md](troubleshooting.md#empty-ui-stub-page).
