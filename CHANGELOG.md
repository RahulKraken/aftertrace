# Changelog

## Unreleased

**Desktop**
- **Restart to update** sets `autoRunAppAfterInstall` before `quitAndInstall`. electron-updater's MacUpdater ignores `isForceRunAfter` and only relaunches when that flag is true; 0.5.4/0.5.5 left it false, so ShipIt replaced the app and did not open it. Quit after a downloaded update still installs without reopening. Signed macos-15 smoke now waits for a new process after Restart and checks that Quit does not spawn one. Installed GitHub v0.5.5 still has the old updater — this build fixes the *next* update after it ships.
- The packaged app never silently reuses whatever is on 7311/4317/4318. A leftover `dev.aftertrace` LaunchAgent is booted out and its plist removed; `~/.aftertrace/aftertrace.duckdb` is kept. Engine start failures (DuckDB lock, missing sidecar) show in the waiting window, with a one-click stop for the old login service.
- One version string from the release tag: Go `-X main.version=vX.Y.Z`, About panel, Restart label, Settings, `GET /api/version`, bundled `aftertrace version`. CI checks the packed engine equals the app version. Packaged builds do not fall through to `aftertrace` on PATH.
- The menu reads `GET /api/health` then `GET /api/glance`. It never says Engine offline while the sidecar process is alive (Starting… / Engine busy). Tray refresh is single-flight; hidden window is 60s. Dashboard polls are single-flight and keep the last snapshot instead of a blank Loading….

**Engine**
- DuckDB opens with `memory_limit=256MB`, `threads=2`, and `allocator_flush_threshold=16MB`. `memory_limit` does not bound process RSS (jemalloc dirty pages stay until the instance is destroyed). After schema/views and after history import the store reopens the file. Health ping is `GET /api/health`. CI seeds a **≥500 MB** DB in a child process and opens it in the parent: **517 MB file, 441 MB peak, 45 MB steady** (caps 600 / 300). Rahul’s 580 MB DB was 3.5–4.3 GB peak / ~1.06–1.35 GB idle unbounded.
- Polled endpoints read ingest-time rollups (`session_stats`, `day_stats`, `trace_roots`, `llm_facts`), not raw `spans`. `turn_roots` is that table, not a UNION+NOT EXISTS over every span. The tray hits `GET /api/health` then `GET /api/glance` only. Window polls are single-flight and slower when hidden. CI `AFTERTRACE_PERF=1` seeds 92k spans / 100 sessions / 501 turns and a 5× file; fail at p95 300 ms, peak RSS 500 MB, idle CPU 5%. On this VM after the fix: 92k cold glance 329 ms, overview p95 17 ms, sessions 1.2 ms, status/findings/health &lt; 1 ms, peak RSS 137 MB, steady 88 MB, idle CPU ~0%; 500k p95 3.8 ms, peak 194 MB. 580 MB for 92k spans is leftover `--store-content` (~6.5 KB/span); serve strips those keys and checkpoints.

## v0.5.5

**Desktop**
- Native session-first Mac menu: stock NSMenu items with identity as the title and activity · session tokens · session `$` as the subtitle (macOS 14.4+; one-line fallback otherwise). Icon-only menu-bar extra; current glyph kept. Click a session to open it. Duplicate repos get a short disambiguator. Unknown amounts omitted, never shown as zero. Today is a quiet header. Linux shares the template. Windows still uses the compact web popover.
- Glance joins `GET /api/overview` live lanes with `GET /api/sessions` by `session_id`. Quiet 90s is not waiting. Live approval-wait includes `claude_code.tool.blocked_on_user`. Historical permission findings stay off the menu.

## v0.5.4

**Desktop**
- Background update check and download via electron-updater. Visible checking / downloading / ready / error states. **Restart to update** is user-triggered; a finished download does not quit the app. Sidecar is stopped before `quitAndInstall`. Update checks hit GitHub Releases only. In-flight checks serialize (no second download); Later still lets the next background pass fetch the zip; offline/cancel stay in error and retry.
- Fail-closed release identity: tag, `desktop/package.json`, updater feed, packed `Aftertrace.app` `CFBundleShortVersionString`, and this CHANGELOG heading must match, and the version must be newer than the shipped 0.5.0 app so installed v0.5.3 can see it.
- Disposable `macos-15` runner probes Aqua (`macos-session-probe.sh`) and runs a signed 0.5.4 → CI-only signed 0.5.5 fixture upgrade (`signed-upgrade-smoke.sh`): download, stay running, explicit Restart, data retained. Local `127.0.0.1` feed only. No ad-hoc resign, no TCC database writes, no production tag/release. Playwright Electron is not the native UI path. `stapler staple` retries CloudKit `NSURLError -1005` / Error 68; it still fails closed on a real staple reject. Consumer `Aftertrace-mac.dmg` must be a byte copy of the stapled arm64 DMG; `stapler validate` is fail-closed on both (retry Error 68, recopy alias). `spctl --type install` on the DMG stays informational; Gatekeeper evidence is app `spctl` **accepted / Notarized Developer ID**.
- File-protocol smoke and `AFTERTRACE_UPDATE_FEED_URL` require an explicit GitHub Actions runner (or `AFTERTRACE_SMOKE_ALLOW=1` in unit tests) plus `AFTERTRACE_SMOKE=1` and `AFTERTRACE_SMOKE_DIR`. They do not arm from a lone env var, and they are not reachable from engine HTTP, the dashboard origin, or IPC. Not a signature bypass: electron-updater still requires the same Developer ID.
- macos-15 Aqua smoke asserts Dock membership while the dashboard is open, close removes Dock/app-switcher while engine+tray stay alive, reopen restores; captures the native custom popover and compact glyph (not Chromium). Published v0.5.3’s Download-then-quit is a one-time transition (asar/compatibility read, not a live old-client→new-client run) and is not patched on the tag.
- Menu popover and first-launch pages are the only IPC senders that can quit, restart, or check for updates. The dashboard origin cannot. Popover navigation is guarded the same way as the dashboard window.
- Dashboard open → Dock + Cmd+Tab. Dashboard closed → menu bar + engine, process stays. Not always-Dock.
- Compact menu-bar popover: current activity, today’s spend, one finding, utilities. Honest freshness. No synthetic “needs you”, no plan-cap meter. Compact square “trace corner” template glyph (not the wide ECG).

**Recap**
- Header numbers (time and value) are loud; connecting prose is quiet. Sessions, commits and lines stay secondary. Decorative chips in the hero are gone.

## Unreleased

**Desktop**
- Desktop unit tests run with `REQUIRE_MAC_NOTARIZE=true` (the tagged Release env) so a PR cannot hide a leak. Pack still fail-closes only on Release (`workflow_call` / `v*` tag). v0.5.2's tagged Release failed `npm test` before pack because that flag was job-wide.
- Mac signing: LICENSE ships in `Contents/Resources/` (electron-builder `extraResources`), not `Contents/`. `extraFiles` put it where `codesign` treats it as nested code and v0.5.1 failed with `code object is not signed at all`. Windows and Linux still include LICENSE under `resources/`.
- Mac notarization runs after pack on the Apple-silicon DMG. If Apple stays In Progress until `notarytool` times out, PR artifacts may stay signed without `Aftertrace-mac-notarized.json`. A tagged GitHub Release fails closed until Apple Accepts and the DMG is stapled. electron-builder's sequential per-app wait cancelled the first signed CI job at 60 minutes after codesign had already succeeded.
- Consumer Mac is Apple silicon: `Aftertrace-mac-arm64.dmg` (and zip) with that chip's Go engine. `Aftertrace-mac.dmg` is a copy so existing `/releases/latest/download` links still work. `latest-mac.yml` lists the arm64 zip only. Intel Mac is not packed, notarized, or advertised.
- When Apple signing and notarization secrets are set, CI signs with Developer ID (hardened runtime, sidecar entitlements), notarizes, staples the arm64 DMG, and requires `stapler validate` plus app `spctl` **accepted / Notarized Developer ID**. Unsigned builds still succeed without those secrets.
- Site **Download for Mac** is the Apple-silicon alias. The right-click first-open note shows only while the latest release is unsigned.

## v0.5.0

**Desktop**
- Mac app as a DMG on GitHub Releases (Windows NSIS, Linux AppImage and deb too), with a site **Download for Mac** button. `electron-updater` reads `latest-mac.yml` / `latest.yml` from the same release. Signed and notarized when Apple secrets are present; unsigned otherwise, with a first-open note (right-click → Open). Engine archives `install.sh` uses stay on that release, names unchanged.
- Electron app in `desktop/`: menu-bar / tray shell that starts the Go engine as a sidecar, loads the existing UI from http://127.0.0.1:7311. Start at login is opt-in.

**Brand**
- Settle mark replaces the three-bar logo: loud first spike, damped decay, calm line, amber dot. Separate small-size drawings, macOS 28×18 menu-bar glyph, platform app icons, favicon, README header. Source in `brand/`.

**Home**
- First-open Home ranks findings by estimated monthly savings, shows at most three, and folds anything under $1/month into a quiet "N smaller tweaks" line. The headline is "About $X/month you could save" (or a calm line when the total is tiny). The raw findings count is off that screen.
- Savings never exceed actual spend over the same window, and a one-day finding is not multiplied into a month. If the honest total is under $1, Home stays with the lean line. A money headline always has cards under it.

**Install**
- `install.sh` starts the login service and opens http://127.0.0.1:7311, so the curl line is the developer option next to the Mac download. `AFTERTRACE_NO_SERVICE=1` / `--no-service` and `AFTERTRACE_NO_OPEN=1` / `--no-open` skip those.

## v0.4.4

**Home**
- History-only Home (imported Claude Code session files, no live tracing) shows the top money finding, cost by project, and recent sessions, instead of empty live tiles.
- Cost by project and recent sessions use the same week as the headline, so the project rows add up to the spend in the sentence.

**Connect / Findings**
- First open shows one finding: the highest monthly USD impact, as an action and a labelled saving. Live export stays optional.
- Findings drop severity chips and the wait banner. The hero is the action sentence, with the monthly saving underneath.

**Copy**
- Spoken numbers in sentences: "49 min", "41¢", "12M". Tables keep exact figures.
- Cost's subtitle is which model or project drove most of this period's spend. History dollars are labelled estimated from session files.

**Rules**
- 14 SQL rules, up from 13: `model.opus_downgrade` flags Opus on tiny turns that never reach for a tool.

## v0.4.3

**History**
- First launch reads Claude Code session files already on this machine (`~/.claude/projects`) and shows recent usage: sessions, tokens, cost estimates, models, by day and by project. Prompt and response text stay on disk; only usage metadata is stored.
- Imported rows are marked `aftertrace.source=history`. Unchanged files are skipped on later starts. If a session later arrives over live OpenTelemetry, the imported copy is dropped so it is not counted twice.

**CLI**
- `aftertrace serve` imports history on start. `--no-history` skips it; `--history-dir DIR` points at another folder.
- `aftertrace import --history [DIR]` does the same job without starting the server.

**Connect**
- First open leads with what was found ("Found N days of Claude Code sessions") and a button to see your usage. Live export is an optional next step. With nothing on disk, it says so and shows the OpenTelemetry snippet.

**Docs**
- The website build no longer treats the `history_files` bookkeeping table as a signal table, so the pages deploy.

## v0.4.2

**Privacy**
- Model output on detailed-beta request spans (`response.model_output`) is now redacted unless you run with `--store-content`. Before this, it was stored whenever Claude Code sent it. To remove it from rows already stored: `UPDATE spans SET attrs = json_merge_patch(attrs, '{"response.model_output": null}') WHERE json_exists(attrs, '$."response.model_output"');`

**Waterfall**
- Parent rows show a count of what sits directly inside them, and the tree line runs from those counts.
- A ⋯ menu on each row (or a right click) collapses or expands everything at that level or every span of that kind, shows only that span, or copies its ID.
- Keys: `-` and `=` fold and open a level, `f` shows only the selected span, Esc goes back.

**Findings**
- "Mark as done" stays on the finding you marked, even as its numbers change. Marks saved by earlier versions are cleared once.

**Docs**
- The docs open on How it works. One interactive figure shows the whole system, and clicking any part opens a page about it, with its own figure and details checked against the source. The pages cover receiving, redaction, the store, findings, reading a turn, and Ask.
- The landing page shows the live figure. The API docs now describe Ask as it works.

## v0.4.1

- Sessions opens on four weeks of activity: point at a day to read it, click to show only its sessions.
- Cost opens on a share ribbon; a slice and its table row light together.
- The App page shows recent requests as a latency scatter; failures in rose, every dot opens its trace.
- Finding impacts count up, query charts draw their lines, and the first data on Connect lands with a ring.

## v0.4.0

**Alive**
- Numbers count to their value and glide when live data changes.
- Sparklines draw themselves over a gradient and show the day and value under the pointer.
- Home has a signature header (the brand's bars drawing in, the amber one breathing while a turn runs).
- Cards cascade in and lift under the pointer; bars grow from their start everywhere, including the Timeline's spans.
- The time split highlights the category you point at.
- Running lanes have light moving through them, and their activity slides to each new step, in plain words ("Running npm test", "Thinking · Opus 5.5", "Waiting for your approval").
- The Recap receipt prints; Story and Timeline, and light and dark, cross-fade.
- Session titles skip Claude Code's side-session preamble.

## v0.3.1

- First run is a welcome: what already works, the one next step (Connect Claude Code), a listening signal, and `aftertrace demo` to look around first.
- A session page leads with the prompt that started it, with its repo, models, turns, time and cost underneath.
- Session titles and turn prompts no longer start with injected `<system-reminder>` text, even when a long prompt was clipped mid-block.
- The inspector uses the same plain words as the row and the card, with a softer edge; the Timeline's stats stay on one line.
- The website uses the app's palette and motion.

## v0.3.0

**Calm, and recognisable**
- A warmer palette (paper neutrals, softer ink, warm charcoal in dark mode) and one family of hues: indigo for the model, teal for tools, amber for you, rose for failure.
- One motion language: pages arrive, the inspector slides in from its edge, the span card grows from its bar, toasts, tooltips and the command palette fade, findings cross-fade, buttons answer a press. Reduced motion is respected.
- Official marks for Claude, Gemini, the services connector tools talk to (Linear, GitHub, Notion, Postgres...) and the programs shell commands run (git, npm, go, python...).
- Numbers in Inter with tabular figures; model ids as "Opus 5.5"; Cost columns in words; finding evidence in words ("waited 22.5s").

**A turn reads as a story**
- Claude Code turns open on a new Story view: what you asked, where the time went in plain words, where it ended and which files changed, then each step in Claude's own words (with content capture on) and its actions as "Read service.go" or "Refactor serve flags and add service dispatch". Long waits for you are their own card, with the questions Claude asked and your answers. Without content capture, steps are grouped by the kind of work.
- The waterfall is now the Timeline view. Calls are grouped into the same steps, closed by default; waits on a person over a minute fold into a labelled band so the work around them stays readable; rows say what happened ("Wrote service.go", a model call in Claude's words) with the context beside it ("Opus 5.5", "Linear").
- Each bar carries its time and cost beside it, the slowest call gets one badge, and a stats strip (duration, waiting on you, cost, tokens, calls, errors) sits on top. Clicking a bar opens a card under it with status, timing, tokens, any error and the input and output; "All details" opens the full inspector.
- Connector tools get an icon for what they are (Linear, GitHub, Notion, a database...), Claude model calls get Claude's mark, and request handlers and app agents are drawn neutral so the calls inside stand out.
- The headline no longer calls a question Claude asked you an approval: "Claude waited 29m 38s for your answer. The work itself took 12m 54s."
- Session titles and turn labels drop injected `<system-reminder>` text.
- `aftertrace demo` and the website demo include one session with synthetic prompts and narration.

## v0.2.0

**Run it at login**
- `aftertrace service install|uninstall|status` keeps `aftertrace serve` running as a LaunchAgent (macOS) or a systemd user unit (Linux), with the flags you pass (for example `--store-content`). It prints every file and command first; `--dry-run` stops there. Logs go to `~/.aftertrace/serve.log`. See [docs/cli.md](docs/cli.md#aftertrace-service).
- Connect suggests the service when the server is not running as one. `/api/status` reports `info.service`.

**Faster under load**
- Reads no longer take the store lock, so a slow query or page never blocks ingest.

**Packaging**
- `scripts/homebrew-formula.sh` prints a Homebrew formula for a release, for anyone running a tap.

## v0.1.0

The first release. Aftertrace is a local-first profiler for your AI work: Claude Code, your own LLM apps and your personal agents, in one binary on your machine.

**See what happened**
- Home: one sentence about your week, agent time, waiting on you, API value, what shipped, and live lanes for every turn still running.
- Sessions titled by your first prompt; turns labelled by what you asked; running turns show up while they run.
- A trace waterfall with a resizable inspector, real input and output per span when you opt into content, a transcript of each turn, and jump-to-error.
- Apps: any service sending OpenTelemetry GenAI spans (Claude SDK, Vercel AI SDK, Pydantic AI, OpenLLMetry, OpenInference, Gemini CLI). Calls, cost, latency and failures per app and per operation.

**Decide what to change**
- 14 findings as SQL rules, each with an impact in time or money, evidence that opens the waterfall, and a fix to copy. Three are for apps: a smaller model would do, model calls failing, prompt caching off.
- "Waiting on you" counts only prompts a person answered; auto-mode and config approvals are permission checks.
- Cost by source, model, skill, subagent, MCP server, tool and repo. App cost is reported or estimated from a price table.

**Ask and share**
- Query builder, read-only SQL, and Ask (opt-in, `--ask`): plain-English questions answered with SQL by Claude. Only the schema and query rows leave the machine.
- Recap: your week as a report and a receipt you can copy as an image.

**Set up**
- Connect: copy-ready snippets for Claude Code, the Agent SDK, Claude SDK apps, any OTel app, Codex and Gemini CLI, with live confirmation of the first span.
- Settings: what is captured and what leaves the machine.
- Content (prompts, responses, tool output) is dropped at ingest unless `--store-content`; email, account and org ids are always dropped.

Install: `curl -fsSL https://rahulkraken.github.io/aftertrace/install.sh | sh`. Docs: [docs/](docs/).
