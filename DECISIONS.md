# Decisions

Short records of choices that are easy to reverse and easy to forget. Newest first.

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
