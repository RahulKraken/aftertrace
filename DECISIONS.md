# Decisions

Short records of choices that are easy to reverse and easy to forget. Newest first.

## Nov 12 2026: report-only scale and energy harness.

**Choice.** One PR, no merge/tag/release. PRs #59, #60 and #61 stay untouched. Engine behaviour on the default `serve` path is unchanged. Add a hidden `aftertrace dev gen-history` command, a `serve --exit-after-warm` test flag, `internal/harness` driving a real `serve` for budgets B1–B9, report-only `internal/store/audit_test.go` table tests for the three known store bugs, a `macos-14` `scale` job (~15 min, 32 MiB corpus) that publishes a JSON artifact and prints markdown (no PR comments), `nightly.yml` with a 10-minute idle, `docs/how-it-works/budgets.md`, and this entry. Budget misses and audit bugs log `known bug` / skip; they do not fail CI. `AFTERTRACE_FAIL_STORE` is a sentinel path Insert checks only when set. Electron main CPU and `powermetrics` are TODOs on GitHub-hosted runners. Each later fix PR flips its own assertion to `t.Fatal`.

**Why.** Need a baseline and a machine-readable report before turning idle CPU, spill, duplicate counts, crash-resume and OTLP retries into hard gates. 2 GiB does not fit a 15-minute `macos-14` job, so CI uses 32 MiB / 80 sessions / seed 42 and says so.

**How to reverse.** Revert the PR. Drop `internal/harness`, `cmd/aftertrace/dev.go`, `--exit-after-warm`, `AFTERTRACE_FAIL_STORE`, the `scale` job, `nightly.yml`, and `docs/how-it-works/budgets.md`.

## Nov 12 2026: ship 0.5.8.

**Choice.** Desktop package, plist, update-feed, and CHANGELOG `## v0.5.8` are 0.5.8. CI fixture is 0.5.9 so macos-15 still has a newer local feed. Tag `v0.5.8` after this bump PR is green and squash-merged. Apple silicon only. Keep earlier tags. Native-instrument redesign from #57 is in this release.

**Why.** Rahul approved merging #57 and shipping signed v0.5.8 at 7:52 AM IST on Nov 12. Installed 0.5.7 needs a newer GitHub Releases `latest-mac.yml` to auto-detect.

**How to reverse.** Revert the bump PR; do not delete earlier tags.

## Nov 11 2026: design-review round 1.

**Choice.** Turn crumbs use the session prompt title; long-turn fixture is 20+ unique rising-timestamp steps. Sessions hide the time-ribbon column below 1180px, wrap inspector titles to 3 lines, 2×2 nowrap stats. Today and Spend share `overview.week`. Elapsed vs agent time are labelled. Resolved findings show the date, quiet Reopen, muted amber, secondary Copy fix. Spend leads with an insight, a model bar + legend, and top 5 sessions. Settings is a 720×640 Mac Settings window with icon tabs. `global.css` and `v4.css` are gone; `token-lint` fails raw font-size/radius/ms outside `tokens.css`. Selection is ≤140ms; WinStage and shimmer are deleted. DESIGN.md is the one design source.

**Why.** Round 1 review of PR #57: hash in the turn header, fake long-turn clocks, Sessions clipped at 1024, Today/Spend totals disagreed, two style systems, leftover celebration motion.

**How to reverse.** Restore `web/src/styles/global.css` and `v4.css` from git; drop `web/scripts/token-lint.mjs`.

## Nov 11 2026: Today week stats never wrap; window min 960.

**Choice.** Dashboard `minWidth` is 960. Today hero values, captions and the sessions/tokens/cache-hit column are `white-space: nowrap`. The Worth changing pane (`--inspector`) narrows first (320 → 260 → 200) and hides below 1000px so the stat row fits. Running-now cost stays on the right; tokens move to the secondary line so the title can use the row.

**Why.** The 1024 Electron Today shot wrapped "49m 8s", "waiting on you", and the facts column, and truncated the live title at "git l…".

**How to reverse.** Restore `minWidth: 880` and the four-column hero grid.

## Nov 11 2026: polish pass on the native-instrument PR.

**Choice.** Open findings count is one number: sidebar, Today "Worth changing", and Findings "N open" all use `openFindings()` (API list minus client resolved marks). Seen-in rows name the session and date, cost on the right. Session inspector turns show a prompt snippet plus time and cost. Today running row is a quiet row + ribbon (no playhead ticks, no 2px min-width stubs). Keyboard hint uses `desktop.platform` so macOS reads ⌘K. macOS CI captures Today/Sessions from a real Electron window (`desktop/scripts/ci-window-shots.js`) so traffic lights and sidebar vibrancy show up.

**Why.** Review of PR screenshots: dollar-only Seen in, 15 vs 14 counts, Turn 1/2/3, ribbon ticks, Ctrl K on a Mac product, Playwright chrome without native window chrome.

**How to reverse.** Revert the follow-up commit. Drop the `macOS UI shots` job if Electron capture is too flaky on macos-15.

## Nov 11 2026: native-instrument redesign, with design-review overrides.

**Choice.** One PR against main, no merge/tag/release. The desktop UI follows SPEC.md (native Mac instrument: Today / Sessions / Findings / Spend, Settings window, Phosphor, SF Pro, one time ribbon) with these review wins over SPEC: a single `usd()` money rule (2 decimals, `<$0.01` for tiny, no cents at $100+, never 3-decimal values); Sessions puts repo under the title instead of a truncating column; Today keeps per-day bars and a legend, not a duplicate week stacked bar; Findings keep the amber hero, native inactive-grey selection, and Copy fix → Copied micro-animation (no WinStage); motion is only selection / sheet / list-reorder, under 200ms, with `prefers-reduced-motion`; Spend, the Settings window, resolved findings and 20+ step turns share the same language and show up in PR screenshots. Silent updater and sidebar `Restart to update` from v0.5.7 stay. Engine and version stay 0.5.7.

**Why.** The previous UI read as a vibe-coded toy: mixed type, truncated finding titles, session hashes, Cost/Recap/Connect competing in the sidebar, 3-decimal money. The review pass kills leftover SPEC mistakes (week bar duplicating day bars, truncated repo, count-ups, WinStage as the primary finding action).

**How to reverse.** Revert the PR. Tokens live in `web/src/styles/tokens.css` + `app.css`; money in `web/src/lib/format.ts` `usd()` and `desktop/src/glance.js` `sayUsd`.

## Nov 11 2026: public README positioning and a Homebrew cask tap.

**Choice.** One PR, no merge/tag/release. README is a first-visit page: one-line time/cost/usage pitch, fixture-UI demo GIF, DMG + `brew install --cask rahulkraken/tap/aftertrace`, an honest supported-tools table (Cursor is not supported), the fourteen shipped rules, local-only privacy with the GitHub Releases update-check and opt-in Ask named, a short fair note vs ccusage and CodeBurn. No security/audit/compliance framing. Community files: bug and feature templates, Discussions for questions, SUPPORT.md. Homebrew ships an **app cask** (`packaging/homebrew/Casks/aftertrace.rb`, v0.5.7 arm64 DMG) meant for `RahulKraken/homebrew-tap`. That tap repo does not exist yet. Same token is not used for a CLI formula. Release Assemble generates `aftertrace.rb` from the built DMG sha256 and attaches it.

**Why.** Reddit / awesome-lists / OpenDMG / Show HN. The old README led with the how-it-works bench, still said builds were unsigned, and advertised Windows/Linux. ccusage and CodeBurn already own token tables; Aftertrace's difference is live, cross-tool time and friction findings. Cursor has no ingest path in this repo.

**How to reverse.** Restore README.md from git history. Drop `.github/ISSUE_TEMPLATE/`, SUPPORT.md, `packaging/homebrew/`, `scripts/homebrew-cask.sh`, and the Release Assemble cask step.

## Nov 10 2026: ship 0.5.7.

**Choice.** Desktop package, plist, update-feed, and CHANGELOG `## v0.5.7` are 0.5.7. CI fixture is 0.5.8 so macos-15 still has a newer local feed. Tag `v0.5.7` after this bump PR is green and squash-merged. Apple silicon only. Keep earlier tags.

**Why.** Rahul approved merging #51 and #53 and shipping signed v0.5.7. Installed 0.5.6 needs a newer GitHub Releases `latest-mac.yml` to auto-detect.

**How to reverse.** Revert the bump PR; do not delete earlier tags.

## Nov 10 2026: ship 0.5.6.

**Choice.** Desktop package, plist, update-feed, and CHANGELOG `## v0.5.6` are 0.5.6. CI fixture is 0.5.7 so macos-15 still has a newer local feed. Tag `v0.5.6` after this bump PR is green and squash-merged. Apple silicon only. Keep earlier tags. PR #51 (Findings pane) stays open and is not in this release.

**Why.** Rahul approved the v0.5.6 release after squash-merging PR #50 (poll rollups, DuckDB cap, Restart-to-update). Installed 0.5.5 needs a newer GitHub Releases `latest-mac.yml` to auto-detect.

**How to reverse.** Revert the bump PR; do not delete earlier tags.

## Nov 9 2026: ingest rollups; never poll raw spans; menu health ≠ overview.

**Choice.** Materialize `trace_roots`, `session_stats`, `day_stats`, `llm_facts`, `source_stats` on Insert. `turn_roots` is a view over that table. `/api/overview`, `/api/sessions`, `/api/status`, `/api/findings`, `/api/glance` read the tables and a 2s single-flight memo. The tray pings `/api/health` (no DuckDB) then `/api/glance`. If health or the sidecar process is alive the menu says Starting/busy, never Engine offline. Renderer polls are single-flight and 60s when hidden. CI `AFTERTRACE_PERF=1` asserts 92k p95 &lt; 300 ms (target 100 ms), peak RSS &lt; 500 MB, steady &lt; 200 MB, idle CPU &lt; 5% (target 1%), 500k p95 &lt; 300 ms. Compact strips `--store-content` keys. No merge/tag/release.

**Why.** Live v0.5.5 on Rahul’s 580 MB / 92k-span file sat at 1.75–1.86 GB RSS and 364–576% CPU with no ingest: six overlapping HTTP polls each ran `turn_roots` (UNION + NOT EXISTS over every span), per-trace Go breakdown, and `json_extract` over the whole file. `/api/sessions` 9.2s, `/api/overview` 27.8s, `/api/status` 2.8s, `/api/health` 404, so the 1.5s glance timeout showed Engine offline while the process was pegged.

**How to reverse.** Restore the `turn_roots` UNION view and per-request `breakdowns.get` / `sources()` scans; point the tray at `/api/status`+`/api/overview` again.

**Record.** Profiles in the CI `engine-perf-profiles` artifact. Do not touch Rahul’s machine.

## Nov 9 2026: never reuse a foreign engine; cap DuckDB; actually relaunch after Restart.

**Choice.** One PR, still 0.5.5 identity, no tag/release. (1) Packaged desktop treats anything on 7311 that is not its child as foreign. It probes `GET /api/version` (then `/api/status`), unloads `gui/$uid/dev.aftertrace`, deletes `~/Library/LaunchAgents/dev.aftertrace.plist` (and `$HOME` if that differs from `os.homedir()`), and starts the bundled sidecar. The DuckDB file stays. Waiting UI shows lock/start errors and a one-click stop. Unpackaged CLI still reuses a healthy 7311. (2) DSN `memory_limit=256MB&threads=2&allocator_flush_threshold=16MB`. Listen, background `history.Import`, then `Store.Reopen()` — DuckDB’s allocator does not return insert/view dirty pages to the OS until the instance is destroyed; a 507 MB file is ~87 MB RSS on a fresh open and ~560 MB if you never reopen. Unix niceness 10, health ping `/api/health`. CI seeds ≥500 MB in a child process and asserts engine-start peak &lt; 600 MB, steady &lt; 300 MB (`AFTERTRACE_RSS_TEST=1`, no `-race`). (3) `requestInstall({relaunch})` sets `autoRunAppAfterInstall` because MacUpdater ignores `isForceRunAfter`. Smoke: Restart must spawn N+1 within 30s with no manual launch; Quit after download must not; a fake `dev.aftertrace` LaunchAgent on 7311 is replaced and the isolated DB marker kept. Go stamp is always `v` + package.json. Packaged `enginePath` never returns PATH `aftertrace`.

**Why.** Rahul's Mac still had a v0.4.2 LaunchAgent (`aftertrace service install`, Oct 22, PID 1786 since Nov 1) holding 4317/4318/7311 and the DuckDB lock. Bundled v0.5.5 died with `Conflicting lock is held … PID 1786`; the UI reused 7311 and Settings showed v0.4.2. Restart on 0.5.4/0.5.5 quit without ShipIt relaunch because `autoRunAppAfterInstall` stayed false; CI then launched N+1 itself. Fresh v0.5.5 on a 580 MB DB sat at 3.5–4.3 GB RSS / 400–515% CPU for ~2 minutes: unconstrained DuckDB (all cores, default memory), history import and COUNT before listen, and `/api/status` (findings + counts) as the health ping.

**How to reverse.** Restore reuse-if-healthy; drop DSN memory/thread caps; put `autoRunAppAfterInstall = false` back as the only Restart path. Do not silently attach to an old login service.

**Record.** Rahul already cleaned the LaunchAgent; do not touch his machine. No merge/tag/release.

## Nov 9 2026: ship 0.5.5.

**Choice.** Desktop package, plist, update-feed, and CHANGELOG `## v0.5.5` are 0.5.5. CI fixture is 0.5.6 so macos-15 still has a newer local feed. Tag `v0.5.5` after this bump PR is green and squash-merged. Apple silicon only. Keep earlier tags.

**Why.** Rahul approved merging PR 48 and shipping an update. Installed 0.5.4 needs a newer GitHub Releases `latest-mac.yml` to auto-detect.

**How to reverse.** Revert the bump PR; do not delete earlier tags.

## Nov 9 2026: stock NSMenu label + sublabel; identity is the default title.

**Choice.** Session rows are stock Electron `MenuItem`s only: `label`, `sublabel` (NSMenuItem.subtitle on macOS ≥ 14.4), separators, checkbox, `type: "header"` for Today on macOS 14+, and a real accelerator on Open Aftertrace. No custom NSMenuItem views, no BrowserWindow, no padded columns, no fake accelerators. Identity is the `label`; activity · tokens · cost is the `sublabel`. Duplicate repos get a short disambiguator (`CLI` / `VS Code`), not a repeated product name. Token counts drop the `tok` suffix. Money is always `$0.40`, never `40¢`. Unknown amounts are omitted. Today is a quiet header (`Today $4.13`). A second stock layout (`label` = activity, `sublabel` = identity · amounts) is behind the smoke/dev switch `AFTERTRACE_MENU_VARIANT` / smoke cmd `variant activity` so both can be captured; it is not a user-facing control. On Darwin < 14.4 or non-Mac, sublabel is omitted and the same facts join on one `label`. Linux uses that fallback. Windows popover is unchanged. Shipping version stays 0.5.4.

**Why.** Rahul rejected the one-line `aftertrace · Claude Code · Thinking · Opus 5.5 · 40k tok · $1.23` as text-heavy, then rejected a custom-drawn column schematic as not an Apple-native menu. ui-copy: any text that doesn’t need to exist shouldn’t; data in tools is content. design-feeling: native structure first, hierarchy through size and light. The default is identity-as-title because the click target is a session (the repo), activity and spend change more often and belong in the quieter subtitle, and duplicate-repo disambiguation already lives on the identity. Variant B is captured in CI for comparison, not shipped as the default.

**How to reverse.** Restore the previous one-line `formatSessionLine` labels; drop `sublabel`, `type: "header"`, and the variant switch.

**Record.** PR 48 follow-up on `cursor/mac-native-session-menu-8312`. No merge/tag/release.

## Nov 8 2026: native session-first NSMenu; tokens and cost on the top-level line.

**Choice.** Mac (and Linux) tray uses Electron `Menu.buildFromTemplate` / `tray.setContextMenu` (real NSMenu on Darwin). The extra is icon-only (`setTitle("")`); the packed glyph is unchanged. Each live session is one enabled item: `repo|tool · doing · session tokens · session $`. Today is a disabled `Today · $X` row (`· estimated` when `history_only`). No Chromium panel on Mac. No submenu for those four fields — NSMenu items are one `NSString`, so this is a compact single line, not a 2–3 line cell. Click opens `/session/{id}`. More than five live lanes: first five + `N more in Aftertrace…` → `/sessions`. Glance joins `/api/overview` live with `/api/sessions` by `session_id`. `liveLanes` latest-span set includes `claude_code.tool.blocked_on_user`. Historical `savings.shown` findings are not on the native menu. Windows popover is unchanged. Shipping version stays 0.5.4; no tag/release. Smoke `menuOpen` stays true until `hide-menu`: Electron 45 `popUpContextMenu` is typed `void` and returns immediately on Darwin, so a `finally { menuOpen=false }` handshake never survived the wait loop. A second click on the extra while the menu is up dismisses it; the runner does not click the glyph after popup. An open NSMenu is not JS-live-updated; labels rebuild on the next open. macos-15 Aqua for tokens/`$` posts **synthetic** OTLP (`aftertrace.synthetic=true`, isolated `AFTERTRACE_HOME`, never Rahul’s `~/.claude`) into the engine of **this job’s notarized 0.5.4 pack** (CDHash + `Aftertrace-mac-notarized.json`). The 0.5.5 zip is a signed upgrade fixture only. `Engine offline` after ingest fails the job. Tray `refresh` is required: glance otherwise stays stale for 45s.

**Why.** After v0.5.4, the web popover showed `live[0].doing`, a prompt snippet, today’s period total, and a permission-count finding. It did not identify concurrent sessions or show per-session tokens/cost, and `setTitle(doing)` shifted other extras. Rahul t125u required identity, activity, **session** tokens and **session** cost visible in the opened top-level menu, a static icon slot, and a real Apple menu.

**How to reverse.** Restore Darwin `createPopover` + `tray.setTitle(formatTitle)` in `desktop/src/tray.js`; drop `sessionMenu.js` and the `/api/sessions` join; remove `blocked_on_user` from `liveDoingSpanNames`. Keep updater/Dock/smoke gates.

**Record.** Implementation of the session-first native menu proposal (canvas `0a754f36-728e-4005-9086-aa8291c64a35`) after t125u. Notion Decision Log: https://app.notion.com/p/4121644e44b6814d840dd2d2f839f9ea. No merge/tag/release in this PR.

## Nov 7 2026: alias stapler fail-closed, Aqua Dock close/reopen, CI-only smoke hooks.

**Choice.** `Aftertrace-mac.dmg` (site `/releases/latest/download`) is a byte copy of the stapled arm64 DMG. `ci-verify-mac.sh` recopy-then-`stapler validate` on the alias and fails the job unless “The validate action worked” (retry CloudKit Error 68). `spctl --type install` on Developer ID DMGs stays informational; Gatekeeper is app `spctl -a -vv` accepted / Notarized Developer ID. Smoke file-protocol + `AFTERTRACE_UPDATE_FEED_URL` + `AFTERTRACE_USER_DATA_DIR` relocate require `AFTERTRACE_SMOKE=1` and either `AFTERTRACE_SMOKE_ALLOW=1` (unit tests) or `GITHUB_ACTIONS=true` plus `RUNNER_TEMP`/`GITHUB_WORKSPACE`. `AFTERTRACE_SMOKE_DIR` is required; no tmpdir cmd file. Not reachable from engine HTTP, dashboard origin, or IPC. electron-updater still requires the same Developer ID (not a signature bypass). macos-15 smoke asserts Dock membership while the dashboard is open, close removes Dock/app-switcher while engine+tray live, reopen restores; captures native popover + compact glyph.

**Why.** Green 9a59270 left alias `stapler validate` Error 68 unfailed (`validate | tee` swallowed the exit). System Events “Finder, Aftertrace” plus a Dock process did not prove close/reopen. `AFTERTRACE_SMOKE=1` alone would have been an accidental control surface in a shipping asar.

**How to reverse.** Restore piped stapler; drop Dock AX asserts and popover cmds; ungated `AFTERTRACE_SMOKE=1`. Do not skip alias validate or app `spctl`.

**Record.** PR 47 final gaps. No merge/tag/release. Published v0.5.3 is not rewritten: its Download-then-quit is a one-time transition, evidenced from asar/compatibility files, not a live 0.5.3→0.5.4 client run.

**Diff scope (~130 files vs main).** In-scope for the five items: desktop updater/dock/popover/glyph/smoke (~16 src, ~15 tests, ~8 scripts, 3 workflows), recap header (`RecapPage.tsx`, `recapStory.ts`, recap-2/3 fixtures, e2e), compact glyph source (`brand/glyphs`, `glyph-corner.svg`, packed `trayTemplate`), Playwright recap/popover/glyph PNGs copied to both `docs/screenshots/` and `web/screenshots/` (same convention as the rest of the site — not unrelated demo regen). Docs/CHANGELOG/DECISIONS, `AFTERTRACE_HOME` engine isolation, site download copy. No extra visual redesign.

## Nov 7 2026: macos-15 signed upgrade smoke; no Aqua-is-missing claim without a session probe.

**Choice.** Desktop Mac CI is `macos-15` (GitHub-hosted arm64), not a blanket `macos-latest` “no Aqua” skip. The job records the actual session (`uname`, console user, `launchctl gui/$uid`, WindowServer/Dock, `screencapture`) before treating GUI as unavailable. A signed 0.5.4 app is copied with `ditto` into `$RUNNER_TEMP`, pointed at a local generic feed (`AFTERTRACE_UPDATE_FEED_URL` must be `http(s)://127.0.0.1`), and updated to a CI-only CSC-signed **0.5.5** fixture (`NOTARIZE_MAC_ARCHES` empty so the fixture is not notarized or published). Isolation is `HOME` + `AFTERTRACE_HOME` + `AFTERTRACE_USER_DATA_DIR`; writes under `/Users/runner/.aftertrace` fail the smoke. File-protocol commands (`AFTERTRACE_SMOKE`) drive check/restart because Playwright’s Electron launcher needs inspect fuses that hardened shipping builds typically disable. Screen Recording Allow is clicked via System Events if a dialog appears; TCC.db is not edited. Ad-hoc `codesign --force` is forbidden. Shipped v0.5.3 is evidence of the old `quitAndInstall` path (asar read + launch without feed rewrite); it is not live-upgraded (that would need a mutated `app-update.yml` and would break the seal). Shipping identity stays 0.5.4.

**Why.** Parent asked for download→ready→still running→Restart→replacement on a disposable GitHub runner, and for an honest v0.5.3 vs 0.5.4 distinction. Official runners are arm64; herminal’s screenshot workflow shows a GUI session exists on `macos-15`. Claiming Aqua is missing without probing that session was unsupported.

**How to reverse.** Drop the fixture pack and smoke steps; pin `macos-latest` again; do not add a production 0.5.5 tag to “make the feed real.”

**Record.** PR 47 follow-up; still no merge/tag/release.

## Nov 7 2026: menu bar glance, Dock while the dashboard is open, user-triggered updater, compact glyph, recap numbers.

**Choice.** Ship 0.5.4 (not a bump of one file): tag / `desktop/package.json` / updater yml / `## v0.5.4` in CHANGELOG must agree, and must be newer than 0.5.0 so installed v0.5.3 (internal 0.5.0) can see the feed. electron-updater against GitHub Releases, `autoDownload` false then we download, `autoInstallOnAppQuit` true, `autoRunAppAfterInstall` false, `allowDowngrade` false. Background detect+download; **Restart to update** is the only relaunch. `before-quit` stops the sidecar then `quitAndInstall`. `LSUIElement` stays true; Dock/Cmd+Tab only while the dashboard window is shown (`setActivationPolicy` + `dock.show/hide`). Custom compact popover (not the unused `#/tray` prototype, not a disabled native menu of greys). Attention: activity 5, spend 2, one finding 2, utilities 1. Quiet ≠ waiting. No plan-cap meter. Menu glyph is an 18×18 “trace corner” (one bend + endpoint), not the 28×18 ECG. Recap hero: time and `$` primary, sessions/commits/lines secondary, no decorative chips.

**Why.** Rahul approved implementation 2026 Nov 7 2:04pm IST: glance at activity/cost without opening the dashboard; dashboard remains a normal Mac app when opened. v0.5.3’s version mismatch meant installed apps could not see a newer feed.

**How to reverse.** Replace tray/visual before merge; retain updater safety (identity floor, no auto-restart, GitHub Releases only). Do not publish/tag until a separate approval; published v0.5.3 stays. No merge/release is authorized by this decision.

**Record.** https://app.notion.com/p/4111644e44b681deb108fe7f8eab75d6 (Status Open, Type Auto-decided; chosen: the five approved items).

## Nov 7 2026: one content grid for the site, one page gutter for the app.

**Choice.** Landing, docs and footer share `--site: 1120px` and `--site-inset` (header already used this inset; the How-it-works figure had been capped at 980px, Start cards at 760px, footer/docs padded 16px inside the 1120 box). Long CLI text is a wrapping `<pre><code>` in the card, not `overflow: hidden` on the page. Landing privacy chips (`.ps code`) stay nowrap so `--store-content` does not split; docs inline code still wraps so a long flag cannot blow the page. The demo/app uses `--page-x` (40px, 16px on a phone) for `.v4`, `.page` and the demo banner so Overview, Findings, Sessions, Recap, Settings and Connect share one left edge. `.page` is left-aligned like `.v4` (no `margin: auto`); Settings' 860px cap must not recenter the column. Week/day bars use `barSlot()`; `niceAxis()` always tops at ≥ max so spend bars stay in the plot; chart SVGs clip instead of painting through the header. Session rows keep five columns when extra metrics hide. Findings tracks stay visible through 1024 (evidence counts hide first; tracks hide at 720). Cost tables scroll inside `.table-scroll`. No new desktop package.

**Why.** Rahul's three shots (illustration vs Local-first cards, the install command crossing the Download card, Overview at 1024) and then "all the pages" were the same class of bug: arbitrary widths, unwrapped mono, and gutters that jumped 16–40px by route. Stacking the home grid away would have hidden the 2-column identity he was looking at.

**How to reverse.** Restore `.band.how .figure-embed { max-width: 980px }`, `.steps { max-width: 760px }`, footer/docs 16px-inside-1120, inline CLI, `.v4-sep { margin: auto -20px 18px }`, and the magic `20.7` / `27.6` bar origins.

## Nov 7 2026: REQUIRE_MAC_NOTARIZE stays on the Package step, not the mac job env.

**Choice.** Desktop `mac` job env does not set `REQUIRE_MAC_NOTARIZE`. The Package step does (Release `workflow_call` / `v*` tag) so fail-closed pack is unchanged. Every Desktop `npm test` (Mac/Win/Linux, including PRs) sets `REQUIRE_MAC_NOTARIZE=true` so a leak cannot stay green on a PR. Tests that spawn `verify-release-assets.sh` clear that variable unless they are testing fail-closed.

**Why.** v0.5.2 Release [42330980385](https://github.com/RahulKraken/aftertrace/actions/runs/42330980385) failed in `npm test` before pack: job env `REQUIRE_MAC_NOTARIZE=true` made `verify-release-assets accepts Apple-silicon Mac files with an arm64 alias` demand `Aftertrace-mac-notarized.json`. PRs never set the flag, so they stayed green.

**How to reverse.** Drop the unit-test env pin; put the flag back on the job `env:` block. Do not: the next tagged Desktop job will fail the same test, and PRs will hide it again.

## Nov 7 2026: consumer Mac is Apple silicon; palette Enter activates the selected row.

**Choice.** CI packs and notarizes `arm64` only (`NOTARIZE_MAC_ARCHES=arm64`, `electron-builder --mac --arm64`). `latest-mac.yml` lists `Aftertrace-mac-arm64.zip` only. The site **Download for Mac** always points at `Aftertrace-mac.dmg` (arm64 alias) and hides the Intel link. A tagged release does not attach `*x64*` Mac files. Gatekeeper evidence is `xcrun stapler validate` on the DMG plus `spctl -a -vv` **accepted / Notarized Developer ID** on the `.app`. `spctl --type install` on the DMG is logged and ignored: a Developer ID disk image is not an installer package, so `no usable signature` is expected. The command palette handles Enter/arrows on the search field; the e2e test waits for the selected row to be the Sessions match before Enter.

**Why.** Rahul does not want an Intel consumer package. Advertising a signed-only x64 DMG next to a notarized arm64 marker would hide the Gatekeeper note for Intel. `spctl --type install` on the arm64 DMG rejected after Apple Accepted and stapler succeeded (Desktop 42268211484); the app assessed as Notarized Developer ID. Playwright `sidebar: g-shortcuts and command palette` stayed on `/#/findings` because Enter in the focused input did not activate the session row (and findings can match `zsh` before sessions load).

**How to reverse.** Pack `--x64` again, list that zip in `latest-mac.yml`, show the Intel site link, and require `spctl --type install` on the DMG if Apple starts treating Developer ID disk images as installers.

## Nov 6 2026: notarize Mac DMGs after pack, one at a time; PRs only send the arm64 DMG.

**Choice.** CI always passes `-c.mac.notarize=false`. `afterAllArtifactBuild` submits DMGs one at a time (arm64 first), `notarytool wait --timeout 5400`. PRs set `NOTARIZE_MAC_ARCHES=arm64` (Intel still signed). Tags and Release (`workflow_call`) set `REQUIRE_MAC_NOTARIZE=true` and notarize both chips. A wait timeout (`notarytool` exit 124) may keep **PR** signed artifacts without `Aftertrace-mac-notarized.json`. The marker is written only after Apple **Accepted** and `stapler staple` succeeds. A `v*` GitHub Release **fails closed** without that marker (`verify-release-assets` + `gh release create` guard). Invalid/Rejected still fails everywhere.

**Why.** Codesign succeeded once LICENSE left `Contents/`. Apple notary then stayed In Progress: 60 minutes (job cancelled), 40 minutes (4 submits, one Accepted), 60 minutes (2 DMGs), 90 minutes (1 arm64 DMG, submission `93496256-a4e0-417e-9037-cab50d3d2ac3`). A green signed PR pack is not a consumer download. Rahul wants an app that opens normally: Developer ID **and** Apple Accepted + stapler/spctl.

**How to reverse.** Drop `REQUIRE_MAC_NOTARIZE` on the Release workflow. Do not write the notarized marker on timeout. Do not re-enable sequential app notarize.

## Nov 6 2026: ship LICENSE via extraResources, not extraFiles, so Mac codesign can seal the app.

**Choice.** Put the Apache LICENSE in electron-builder `extraResources` (`Contents/Resources/LICENSE` on Mac, `resources/LICENSE` on Windows and Linux). Do not use `extraFiles` for it. `after-pack` fails if anything unexpected sits at `Contents/` top level.

**Why.** `extraFiles` copies into `Aftertrace.app/Contents/` on Mac. `codesign` then treats `Contents/LICENSE` as nested code: `code object is not signed at all / In subcomponent: …/Contents/LICENSE`. That is what failed v0.5.1 after Developer ID secrets were present. Unsigned PRs never ran codesign, so the placement was invisible until then. Windows and Linux extraFiles placement was valid; they still get LICENSE, just under `resources/`.

**How to reverse.** Restore the `extraFiles: { from: ../LICENSE, to: LICENSE }` block and drop the Contents/ layout assertion. Do not do that unless Apple changes nested-code rules.

## Nov 3 2026: per-chip Mac DMGs instead of universal, with Aftertrace-mac.dmg kept as an arm64 alias.

**Choice.** Build separate `arm64` and `x64` Mac apps (DMG + zip), each bundling only the matching Go engine. Stable names `Aftertrace-mac-arm64.dmg` and `Aftertrace-mac-x64.dmg`. Copy the arm64 DMG to `Aftertrace-mac.dmg` so `/releases/latest/download/Aftertrace-mac.dmg` and the site button stay valid. `latest-mac.yml` lists both zips; electron-updater picks by arch. Notarize and staple when `CSC_LINK` + Apple credentials are present; unsigned otherwise.

**Why.** The universal DMG was ~278 MB because it shipped two Electron runtimes and a fat engine. Per-chip cuts that roughly in half and still double-clicks like a real Mac app once Developer ID + notarization secrets exist.

**How to reverse.** Return `desktop/scripts/ci-pack.sh` / `pack:mac` to `--mac --universal`, lipo the engine again in `.github/workflows/desktop.yml`, and restore `artifactName: Aftertrace-${os}.${ext}` for Mac. Keep the `Aftertrace-mac.dmg` name.

## Nov 2 2026: v0.5.0 ships the Mac app as a DMG on GitHub Releases with a site Download button; signed when Apple secrets exist, unsigned with a first-open note until then.

**Choice.** A `v*` tag builds Mac (universal DMG + zip), Windows (NSIS) and Linux (AppImage + deb) desktop packages and attaches them to the GitHub Release next to the existing Go engine archives. Stable names (`Aftertrace-mac.dmg`, `latest-mac.yml`, `latest.yml`) so the site can link to `/releases/latest/download/Aftertrace-mac.dmg` and electron-updater can find the zip/exe. Apple secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` or `APPLE_API_KEY*`, `APPLE_TEAM_ID`) sign and notarize when present; missing secrets still produce an unsigned build. The website's primary button is Download for Mac, with a right-click → Open note until notarization is on. `install.sh` is unchanged.

**Why.** The desktop app is the one-click path. The curl installer stays for developers. One release, both audiences.

**How to reverse.** Revert this commit. Engine archives, `install.sh` and the Desktop PR workflow stay.

## Nov 1 2026: UI redesign v4 grounded in AI-product usage consoles (OpenAI, Anthropic, Cursor, xAI, ElevenLabs etc.); budget meter only when user-set.

**Choice.** Home, Findings, Sessions, Recap and the tray follow v4: hairline cards, Inter UI, Geist Mono for tokens and model chips (`opus` / `sonnet`), Newsreader only on the wordmark, system theme with a light fallback, amber only for savable money. Usage meters with a reset countdown (Claude Code 5h window) appear only when the engine can see a start; a spend-vs-budget meter appears only when the user has set a weekly cap in Settings. Numbers come from the engine. The Home honesty cap (savings never exceed spend, cards under a money headline, lean under $1) stays.

**Why.** AI consoles share those five patterns (usage meter, mono model chips, token counts, runs+trace pane, Running/Done chips). A fake $60 cap or invented quota would lie the same way an uncapped savings headline did.

**How to reverse.** Revert this commit. Tokens, honesty tests and the Settle logo stay.

## Nov 1 2026: Home savings are capped at observed spend and never invent days; reversible by reverting this commit

**Choice.** Monthly savings on Home use a shared observation window (actual LLM spend and its first/last timestamp in the last month). Each finding is capped at the dollars it refers to — a one-day $0.02 cache drop stays $0.02, not ×30. The headline is the sum of shown cards plus folded, and that total cannot exceed observed spend over the same window (scaled down only when the window is longer than 30 days). If the honest total is under $1, Home says "Your setup looks lean. Here's what we saw this month." A money headline always has at least one card: top three even when every finding is sub-$1. "N smaller tweaks" is only for folded items that are truly under $1.

**Why.** Ranking by each finding's own span turned 66 ~1¢ compaction findings into "$24/month" with zero cards, while this week's spend was 82¢. The number did not add up, and the proof was missing.

**How to reverse.** Revert this commit. The $1 fold threshold and three-card cap stay.

## Nov 1 2026: Home ranks findings by monthly savings, shows top 3, folds sub-$1 ones; reversible by reverting this commit

**Choice.** First-open Home leads with estimated monthly savings: rank USD findings by monthly dollars, show at most three cards at or above $1/month, fold the rest into one quiet line ("N smaller tweaks" or "N more") that links to Findings. Headline is "About $X/month you could save" summing shown and folded; if the total is under $1, a calm line instead ("Your setup looks lean. Here's what we saw this month."). No raw "N findings" count on Home.

**Why.** Imported history produced a 2¢ hero and a "66 findings" badge. Count and recency are the wrong sort. The value is the money, including lots of small tweaks that only add up together.

**How to reverse.** Revert this commit. Findings themselves and the Findings page stay as they are.

## Nov 1 2026: new logo — Settle mark (loud first spike, long damped decay, calm line, amber dot), ink #1F1D1A / cream #EFEAE2 / amber #E29A2E, separate small-size drawings, wide 28x18 menu-bar template glyph. Reversible: restore old Logo.tsx/favicon from git history.

**Choice.** Replace the three-bar waterfall mark with the Settle mark everywhere: app icons (icns / ico / hicolor + SVG), macOS template tray glyph, web favicon and `Logo.tsx`, README header, and the website. Source drawings and rebuild scripts live in `brand/`.

**Why.** The old bars read as a generic stacked-chart icon. Settle is a single damped trace that settles on an amber dot — the same story as the product (a loud start, a decay, a calm line). Small sizes are separate drawings, not scaled masters, so 16px and the menu bar stay legible.

**How to reverse.** Restore `web/src/components/Logo.tsx`, `web/public/favicon.svg`, `desktop/resources/`, `site/build.mjs` `LOGO`, and the README header from git history. Drop `brand/` and `docs/brand/` if the kit is not needed.

## Electron as the desktop shell (2026-10-31)

**Choice.** Ship a thin Electron app in `desktop/` that starts the existing Go engine as a supervised sidecar, loads the existing React UI from `http://127.0.0.1:7311`, and lives in the menu bar / tray. Packaging is electron-builder (Mac dmg+zip, Windows nsis, Linux AppImage+deb) with electron-updater against GitHub Releases.

**Why.** Cross-platform maturity and reliability over size, matching Rahul's Hush app. A non-terminal user can download Aftertrace, open it, and see their usage findings with no install.sh step. SwiftUI was rejected because it does not travel to Windows and Linux. Tauri was rejected because each OS gets a different webview, so the UI would not behave the same.

**How to reverse.** Delete `desktop/` and `.github/workflows/desktop.yml`. The engine, the embedded UI, `install.sh` and `aftertrace service` stay as they are; the shell never forked them.

## One-line install that finishes setup (2026-10-31)

**Choice.** `install.sh` downloads the latest release, runs `aftertrace service install` (launchd on macOS, systemd `--user` on Linux), waits until http://127.0.0.1:7311 answers, and opens the default browser. Opt out with `AFTERTRACE_NO_SERVICE` / `AFTERTRACE_NO_OPEN` or `--no-service` / `--no-open`.

**Why.** Every extra step before the first screen loses people. v0.4.4 already shows last month's Claude Code history and a finding on first open; getting there is the product.

**How to reverse.** Pass the opt-out flags, or revert `install.sh`.

## Home cost is one week (2026-10-30)

**Choice.** History-only Home's cost-by-project rows and recent sessions use the same `lo`/`hi` as the headline week (`GET /api/overview` `projects` from `history.ProjectsIn`, not all-time `Summarize`). Project row dollars sum to `week.cost_usd`. Connect's history summary stays all imported history.

**Why.** The sentence said this week's spend; the rows under it summed last month. Two windows on one screen.

**How to reverse.** In `internal/api/overview.go`, set `projects` from `history.Summarize` again and stop filtering `recent` to `lo`/`hi`. Drop `ProjectsIn`.

## Home for history-only, spoken numbers, quieter findings (2026-10-29)

**Choice.** Users with only imported Claude Code session files (`aftertrace.source=history`, no live OTel) get a Home that is not the live dashboard: the top money finding (same pick as Connect: highest USD, ties by severity), cost by project, recent sessions, and one quiet line to turn on live tracing. Live-only tiles stay off — Live now, waiting-on-you, Shipped (it reads `metric_points`, which history never writes), time split, sources. The decorative HeroMark bars come off Home for everyone. Findings drop high/Bottleneck/Cost chips and the "35.7s of waiting" banner; the hero is the action sentence with the monthly saving line under it. Severity still sorts the list. Cost's subtitle is one generated sentence (which model or project drove most spend); history-derived dollars are labelled estimated from session files; the ribbon no longer says "Point at a slice or a row". Sentence copy uses one spoken formatter (`sayDur` / `sayUsd` / `sayTok`, and `internal/prose` on the Go side): "49 min", "41¢", "12M". Tables keep `dur` / `usd` / `tok`.

**Why.** History-only Home was empty or lying (Shipped at zero, live lanes quiet). First open already spent its ten units on one finding; Home should not spend them again on live chrome the data cannot fill. Chips and wait banners are a second focal point. Schema notes and hover hints are not the product. "12.40M tokens" is a table number in a sentence.

**How to reverse.** Home: restore `HeroMark` and the five-tile strip for history-only in `web/src/pages/HomePage.tsx`; drop `history_only` / `projects` from `GET /api/overview`. Findings: put the severity pill, pillar chips and `hero-imp` back in `FindingsPage.tsx`. Cost: restore `costNote` in `internal/api/sessions.go` and the "Point at a slice or a row" caption. Copy: switch sentences back from `sayDur`/`sayUsd`/`sayTok` to `dur`/`usd`/`tok`.

## Show one finding on first open instead of a list (2026-10-29)

**Choice.** The first-run Connect screen keeps the spend summary, then shows exactly one finding: the highest monthly USD impact, ties to the higher-severity (confidence) finding. A plain action sentence (not the rule title), a labelled monthly saving (or an honest cost over the dates), the project and time span, and Show me. Below that, a quiet "See all findings" link and a one-line nudge that live tracing also catches slow hooks and retry waste. No list, no severity colours. If nothing qualifies: "Nothing worth changing in last month's history". History findings are labelled "estimated from session files".

**Why.** First open has about ten units of attention. A list of findings competes with the spend total and with the next action. One change is the product: the Findings page already ranks a hero. Repeating a list here would spend the budget twice.

**How to reverse.** In `web/src/pages/ConnectPage.tsx`, restore the project list and "See your usage" CTA from v0.4.3, and drop the `found-one` block. `GET /api/status` can stop sending `welcome_finding` (`rules.PickMoneyFinding`). The Findings page is unchanged.

## Cut v0.4.3 so history import reaches install.sh users (2026-10-28)

**Choice.** Publish v0.4.3 from current main (history import, first-run Connect, `import --history` / `serve --no-history`, site facts fix). `install.sh` still downloads v0.4.2, which has none of that, while the README already says history is in on first launch.

**Why.** People who install from the website get a binary that does not match the docs. The code is already on main.

**How to reverse.** Publish a follow-up patch that drops or gates the import, or replace the GitHub release so `install.sh`'s latest points at a different tag.

## Local session import as first-run backfill (2026-10-27)

**Choice.** On `serve`, Aftertrace reads Claude Code's local session JSONL (`~/.claude/projects/<slug>/*.jsonl` and `*/subagents/*.jsonl`) into the existing DuckDB. OTel stays the live feed. Imported rows are usage metadata only, marked `aftertrace.source=history`. The first-run Connect screen leads with what was found and treats live export as optional.

**Why.** A new install with OTel-only ingest is empty until the user edits settings, restarts Claude Code, and runs a turn. The transcripts are already on disk; they are enough for sessions, tokens, cost estimates, models, and breakdowns by day and by project. Waiting-on-you and live turns still need OTel.

**How to reverse.**

- Skip future imports: `aftertrace serve --no-history` (or pass that flag to `service install`).
- Drop imported rows, keep live OTel:

  ```sql
  DELETE FROM span_events WHERE trace_id IN (
    SELECT trace_id FROM spans WHERE json_extract_string(resource, '$."aftertrace.source"') = 'history');
  DELETE FROM spans WHERE json_extract_string(resource, '$."aftertrace.source"') = 'history';
  DELETE FROM events WHERE json_extract_string(resource, '$."aftertrace.source"') = 'history';
  DELETE FROM metric_points WHERE json_extract_string(resource, '$."aftertrace.source"') = 'history';
  DELETE FROM history_files;
  ```

- Wipe the store: delete `~/.aftertrace/aftertrace.duckdb` and its `.wal`.
