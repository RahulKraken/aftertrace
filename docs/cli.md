# CLI

`aftertrace` has five commands: `serve`, `import`, `demo`, `service` and `version`. Unknown commands and a missing command print usage and exit 2.

```
Aftertrace — local profiler for Claude Code.

Usage:
  aftertrace serve   [--db PATH] [--listen HOST] [--grpc-port N] [--http-port N] [--ui-port N] [--store-content] [--ask] [--no-history] [--history-dir DIR]
  aftertrace import  [--db PATH] [--store-content] <dir>
  aftertrace import  --history [--db PATH] [DIR]
  aftertrace demo    [--db PATH]
  aftertrace service install [--dry-run] [serve flags]
  aftertrace service uninstall [--dry-run]
  aftertrace service status
  aftertrace version
```

`help`, `-h`, and `--help` print the same text. Each command also accepts `-h` for its flags. Go's flag package accepts both `-db` and `--db`.

Default `--db` is `$HOME/.aftertrace/aftertrace.duckdb`. If `$HOME` cannot be resolved, it is `aftertrace.duckdb` in the current directory. The parent directory is created if needed.

## `aftertrace serve`

Start the OTLP receivers and the UI / JSON API. Blocks until SIGINT or SIGTERM.

```
Usage of serve:
  -ask
    	answer English questions with Claude (sends schema and query results to the Anthropic API)
  -db string
    	DuckDB file (default "$HOME/.aftertrace/aftertrace.duckdb")
  -grpc-port int
    	OTLP gRPC port (default 4317)
  -history-dir string
    	Claude Code projects directory to import (default "$HOME/.claude/projects")
  -http-port int
    	OTLP HTTP port (default 4318)
  -listen string
    	bind address (use 0.0.0.0 for team mode) (default "127.0.0.1")
  -no-history
    	do not import Claude Code session transcripts on start
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
ask=off
```

| Flag | Default | Notes |
| - | - | - |
| `--db` | `$HOME/.aftertrace/aftertrace.duckdb` | DuckDB file. Exclusive lock; only one process. |
| `--listen` | `127.0.0.1` | Bind host for gRPC, HTTP, and UI. `0.0.0.0` accepts remote OTLP. |
| `--grpc-port` | `4317` | OTLP gRPC (traces, logs, metrics). |
| `--http-port` | `4318` | OTLP HTTP. `POST /v1/traces`, `/v1/logs`, `/v1/metrics`. JSON or protobuf. |
| `--ui-port` | `7311` | UI and `/api`. |
| `--store-content` | off | Keep the content keys in [privacy.md](privacy.md). Identity keys are still dropped. |
| `--ask` | off | Turn on Ask on the Query page. Needs `ANTHROPIC_API_KEY`; exits 1 without it. `AFTERTRACE_ASK_MODEL` picks the model (default `claude-opus-5-5`). See [privacy.md](privacy.md#ask). |
| `--no-history` | off | Skip importing Claude Code session JSONL from `--history-dir` on start. |
| `--history-dir` | `$HOME/.claude/projects` | Projects tree to scan. Missing dir is not an error. |

A bound port exits 1:

```
otlp grpc: listen tcp 127.0.0.1:4317: bind: address already in use
```

## `aftertrace import`

Two modes. Without `--history`, read a collector file-exporter directory into DuckDB, then run every rule and print findings. With `--history`, read Claude Code session transcripts (usage metadata only) from `~/.claude/projects` or DIR. Both are idempotent. Exits when it is done.

```
Usage of import:
  -db string
    	DuckDB file (default "$HOME/.aftertrace/aftertrace.duckdb")
  -history
    	import Claude Code session transcripts instead of collector JSONL
  -store-content
    	keep prompt/response/tool content attributes
```

Without `--history`, positional: exactly one directory. Missing dir or extra args exit 2:

```
usage: aftertrace import [--db PATH] [--store-content] <dir>
       aftertrace import --history [--db PATH] [DIR]
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

### `import --history`

```bash
aftertrace import --history --db ./data/aftertrace.duckdb
aftertrace import --history --db ./data/aftertrace.duckdb /path/to/projects
```

Scans `*.jsonl` at the top of each project slug, plus `*/subagents/*.jsonl`. Does not walk `memory/` or other nested files. Writes spans and `api_request` events so the `llm`, `tools` and `turn_roots` views work; marks every row `aftertrace.source=history`. Cost is estimated from the price table. Prompt and response text are never stored, even if `--store-content` is also passed. Files whose size and mtime have not changed are skipped. Sessions that already have live OTel rows are skipped. Details: [claude-code-setup.md](claude-code-setup.md#local-session-history).

## `aftertrace demo`

Generate seven synthetic Claude Code sessions, import them, print counts and findings. No OTLP ports. `--store-content` is not a flag; demo ingest always redacts.

```
Usage of demo:
  -db string
    	DuckDB file (default "$HOME/.aftertrace/aftertrace.duckdb")
```

```bash
./aftertrace demo --db ./data/aftertrace.duckdb
```

```
loaded 7 synthetic sessions into ./data/aftertrace.duckdb
spans=1257 span_events=181 events=591 metric_points=861  (aftertrace.synthetic=true)
16 findings
[high] retry.exhausted  An API request gave up after 11 attempts
...
[medium] model.opus_downgrade  inbox uses claude-opus-5 for 35-token turns with no tools
...
run: aftertrace serve --db ./data/aftertrace.duckdb
```

Every record has resource attribute `aftertrace.synthetic=true`. The generator is `internal/demo`. Every shipped rule fires on this data; the clean haiku session is left uncited.

Demo and serve cannot share a DB at the same time:

```
open db: ... Could not set lock on file "./data/aftertrace.duckdb": Conflicting lock is held ...
```

Stop `serve`, run `demo`, start `serve` again.

## `aftertrace service`

Keep `aftertrace serve` running at login. The curl installer runs `service install` for you. From the CLI, nothing is written or started until you run `install`, and every file and command is printed before it happens.

| | macOS | Linux |
| - | - | - |
| Manager | launchd (LaunchAgent) | systemd `--user` |
| File | `~/Library/LaunchAgents/dev.aftertrace.plist` | `~/.config/systemd/user/aftertrace.service` (`$XDG_CONFIG_HOME` if set) |
| Starts | at login (`RunAtLoad`) | with your user manager (`WantedBy=default.target`) |
| Restarts | always (`KeepAlive`) | always, after 5 s (`Restart=always`) |
| Output | appended to `~/.aftertrace/serve.log` | appended to `~/.aftertrace/serve.log` |

Windows exits 1: `aftertrace service supports macOS (launchd) and Linux (systemd), not windows`.

### `install`

```
Usage of service install:
  -dry-run
    	print the file and commands without writing or running anything
```

plus every `serve` flag except `--ask`. Only the flags you pass are written into the service; the rest keep `serve`'s defaults. A relative `--db` is made absolute, because the service does not start in your current directory.

```bash
aftertrace service install --store-content
```

```
Writing /Users/you/Library/LaunchAgents/dev.aftertrace.plist:

<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>dev.aftertrace</string>
	<key>ProgramArguments</key>
	<array>
		<string>/usr/local/bin/aftertrace</string>
		<string>serve</string>
		<string>--store-content</string>
	</array>
	<key>EnvironmentVariables</key>
	<dict>
		<key>AFTERTRACE_SERVICE</key>
		<string>launchd</string>
	</dict>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>/Users/you/.aftertrace/serve.log</string>
	<key>StandardErrorPath</key>
	<string>/Users/you/.aftertrace/serve.log</string>
</dict>
</plist>

Running:
  launchctl enable gui/501/dev.aftertrace
  launchctl bootstrap gui/501 /Users/you/Library/LaunchAgents/dev.aftertrace.plist

$ launchctl enable gui/501/dev.aftertrace
$ launchctl bootstrap gui/501 /Users/you/Library/LaunchAgents/dev.aftertrace.plist
Aftertrace is running at http://127.0.0.1:7311 and will start again at login.
Logs: /Users/you/.aftertrace/serve.log
```

On Linux it writes this unit, then runs `systemctl --user daemon-reload`, `systemctl --user enable aftertrace.service` and `systemctl --user restart aftertrace.service`:

```ini
[Unit]
Description=Aftertrace, a local profiler for Claude Code and AI apps
Documentation=https://github.com/RahulKraken/aftertrace/blob/main/docs/cli.md#aftertrace-service

[Service]
ExecStart=/usr/local/bin/aftertrace serve --store-content
Environment=AFTERTRACE_SERVICE=systemd
Restart=always
RestartSec=5
StandardOutput=append:/home/you/.aftertrace/serve.log
StandardError=append:/home/you/.aftertrace/serve.log

[Install]
WantedBy=default.target
```

systemd stops user services when you log out unless lingering is on. Install prints the command when it is off; it does not run it for you:

```bash
loginctl enable-linger "$USER"
```

Notes:

- The service runs the binary you ran `install` with. A Homebrew-style `Cellar/aftertrace/<version>/bin/aftertrace` is replaced by the `bin/aftertrace` link next to it so upgrades keep working. A `go run` binary is refused.
- If the ports are taken and the service is not already running, install exits 1 instead of leaving a service that fails and restarts forever:

  ```
  127.0.0.1:4317 is in use. If that is an `aftertrace serve` you started by hand, stop it first (pkill -f 'aftertrace serve'): the service needs the ports and the database
  ```

- Running `install` again replaces the file and restarts the service. Use it to change flags or after replacing the binary.
- `--ask` exits 1: a login service does not see `ANTHROPIC_API_KEY` from your shell. Run `aftertrace serve --ask` by hand.
- `AFTERTRACE_SERVICE` tells the server it runs as a service. `/api/status` reports it as `info.service`, and Connect stops suggesting the service.
- `serve.log` is appended to and never rotated.

### `status`

```
service   launchd  /Users/you/Library/LaunchAgents/dev.aftertrace.plist
command   /usr/local/bin/aftertrace serve --store-content
state     running (pid 61400)
log       /Users/you/.aftertrace/serve.log
```

Exits 0 when the service is running, 3 when it is installed but not running or not installed at all:

```
Not installed (no /Users/you/Library/LaunchAgents/dev.aftertrace.plist).
Run `+"`aftertrace service install`"+` to keep Aftertrace running at login.
```

### `uninstall`

Stops the service and removes the file. The database and `serve.log` stay. `--dry-run` prints what it would do.

```
Running:
  launchctl bootout gui/501/dev.aftertrace
Removing /Users/you/Library/LaunchAgents/dev.aftertrace.plist

$ launchctl bootout gui/501/dev.aftertrace
Uninstalled. The database and /Users/you/.aftertrace/serve.log are left as they are.
```

On Linux: `systemctl --user disable --now aftertrace.service`, remove the unit, `systemctl --user daemon-reload`.

There is no `init` or `purge` command.
