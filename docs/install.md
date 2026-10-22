# Install

Aftertrace is one binary with an embedded DuckDB and an embedded React UI. Nothing else to run.

## Install a release (macOS and Linux)

```bash
curl -fsSL https://rahulkraken.github.io/aftertrace/install.sh | sh
```

The script picks the archive for your OS and CPU (macOS arm64 or Intel, Linux amd64 or arm64) from the [latest release](https://github.com/RahulKraken/aftertrace/releases/latest), checks it against `checksums.txt`, and installs `aftertrace` to `/usr/local/bin` if you can write there, otherwise `~/.local/bin`. `AFTERTRACE_VERSION=v0.1.0` pins a version; `AFTERTRACE_BIN=/some/dir` picks the directory. Read [`install.sh`](../install.sh) first if you prefer; it is short.

Or download an archive from the releases page, untar it, and put `aftertrace` on your `PATH`.

```bash
aftertrace version
aftertrace serve
```

Then open http://127.0.0.1:7311 and go to **Connect**.

Windows is not packaged yet. Build from source below (DuckDB ships a `windows-amd64` library; you need a CGO toolchain such as MSYS2 MinGW).

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
