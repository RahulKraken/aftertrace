# Decisions

Short records of choices that are easy to reverse and easy to forget. Newest first.

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
