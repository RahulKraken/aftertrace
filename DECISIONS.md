# Decisions

Short records of choices that are easy to reverse and easy to forget. Newest first.

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
