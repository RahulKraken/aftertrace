# Scale and energy budgets

Report-only numbers for the engine. A miss does not fail CI. Later PRs turn each row into a hard gate. The harness lives in `internal/harness` and drives a real `aftertrace serve` process. Audit reproductions in `internal/store/audit_test.go` log `known bug` and skip instead of failing.

The shipped DSN is `memory_limit=256MB` (244 MiB). The harness does not raise it.

A pass on a corpus smaller than 2 GiB, or an idle window shorter than 10 minutes, is **not representative** of the field: Rahul's Mac holds a 735 MB DuckDB file and 7.9 GB of `~/.claude/projects`, and OOMs at the 244 MiB cap. `gen-history` spends most of `--size` on tool-result padding that ingest strips, so the generator also writes 48–79 assistant usage turns per session. Without those turns a 2 GiB tree still yields a ~27 MB DB and never approaches the cap.

## How to run

```
# Hidden corpus generator (Claude Code ~/.claude/projects JSONL).
aftertrace dev gen-history --size 2GiB --sessions 3000 --seed 42 --dir /tmp/projects

# Full local run (2 GiB floor, 3000 sessions, 10-minute idle, 10 crash trials).
AFTERTRACE_HARNESS=1 AFTERTRACE_HARNESS_PROFILE=full go test -count=1 -timeout 8h ./internal/harness -run TestScaleBudgets -v

# Nightly-shaped run (512 MiB, 800 sessions, 10-minute idle, 10 crash trials).
AFTERTRACE_HARNESS=1 AFTERTRACE_HARNESS_PROFILE=nightly go test -count=1 -timeout 3h ./internal/harness -run TestScaleBudgets -v

# PR CI-shaped run (32 MiB, 80 sessions, 20 s idle, 10 crash trials). Not representative.
AFTERTRACE_HARNESS=1 AFTERTRACE_HARNESS_PROFILE=ci go test -count=1 -timeout 20m ./internal/harness -run TestScaleBudgets -v
```

`serve --exit-after-warm` exits after history import, compact, rollups and reopen. `AFTERTRACE_FAIL_STORE` is a sentinel path captured at Open; Insert stats it only when set. `AFTERTRACE_REOPEN` is a harness sentinel that forces `Store.Reopen` during B6. `AFTERTRACE_PPROF=1` serves `/debug/pprof/` with `pprof.Do` route labels. Unset in production.

Profiles:

| Profile | JSONL size | Sessions | Idle | Isolation | Crash trials | Where |
|---|---|---|---|---|---|---|
| `ci` | 32 MiB | 80 | 20 s × 3 scenarios | 8 s / endpoint | 10 (kill after 5–90% of sessions) | PR `scale` job on macos-latest, ~15 min |
| `nightly` | 512 MiB | 800 | 10 min × 3 | 2 min / endpoint | 10 | `nightly.yml` daily |
| `full` | 2 GiB | 3000 | 10 min × 3 | 2 min / endpoint | 10 | local / weekly Sunday job / `workflow_dispatch` profile=full |

CI `workflow_dispatch` runs only the scale job and accepts `profile`, `corpus`, `sessions`, `idle`, and `crash_trials`. Empty inputs keep the profile defaults. PR CI keeps the small corpus so the job stays around 15 minutes.

Idle cadences are the real client timers (`internal/harness/cadence.go`). `TestCadencesMatchSources` greps `desktop/src/tray.js`, `desktop/src/engine.js`, `web/src/pages/HomePage.tsx`, `web/src/pages/SessionPage.tsx`, and `web/src/components/Shell.tsx`. Findings are never polled; they refresh as a side effect of glance/status/overview/session, at most every 30 s.

| Scenario | Who | Cadence | B1? |
|---|---|---|---|
| `window_closed` | supervisor `/api/health`; tray health then glance | 1 s; 60 s (`HIDDEN_MS`) | **yes, this is the gate** |
| `window_open_idle` | status; home overview+sessions; tray | 15 s; 30 s; 45 s (`IDLE_MS`) | report |
| `live` | home; session; popover | 4 s; 5 s; 12 s (`OPEN_MS`) | report |

Per-endpoint isolation CPU is a separate ~2-minute window (8 s in CI) that hits one route every 1 s and records the engine process's CPU change (`getrusage` / `ps` / `/proc/<pid>/stat`). That includes DuckDB worker threads and a findings refresh. Drill-down is env-gated `net/http/pprof` with `pprof.Do` route labels; the findings-refresh goroutine is labelled `findings-refresh`. Not `RUSAGE_THREAD`.

`powermetrics` starts in the background for the WINDOW CLOSED idle window when `AFTERTRACE_POWERMETRICS=1` (nightly/weekly). Electron main-process CPU still needs a packaged desktop or a self-hosted Mac with sudo.

## Ratchet

`internal/harness/testdata/baseline-<profile>.json` is the stored baseline. CI fails if a previously green budget turns red, or a stored resource number regresses by more than about 10%. Already-red correctness budgets stay red until their owner PR. `AFTERTRACE_HARNESS_RATCHET=0` skips the check.

| Budget | Owner PR | Gate |
|---|---|---|
| B3 no-op restart writes | PR 3 | resource, nightly/full |
| B6 reads under Reopen | PR 4 | correctness, PR |
| B1 idle CPU, B2 idle disk | PR 5 | resource, nightly/full |
| B7 duplicate counts | PR 6 | correctness, PR |
| B9 OTLP 503/UNAVAILABLE | PR 7 | correctness, PR |
| B4 RSS, B5 spill, B8 crash resume | PR 8 | resource (B4/B5) nightly/full; correctness (B8) PR |

Correctness budgets B6–B9 become PR gates in those owner PRs. Resource budgets B1–B5 stay nightly and full-run gates. This PR is still report-only: a miss logs `known miss` and does not fail the job except via the ratchet (green→red / >10% resource).

## Targets

| ID | Budget | Target |
|---|---|---|
| B1 | Idle engine CPU | About 0. At most 3 CPU-seconds in 10 minutes, **window closed**: supervisor `/api/health` every 1 s, tray health then glance every 60 s, no incoming data. Sample `ps -o time` / `/proc/<pid>/stat` every 1 s. Electron main ≤ 2 CPU-seconds (TODO in CI). |
| B2 | Idle disk writes | 0. DB file and WAL size and mtime unchanged during the WINDOW CLOSED idle window. |
| B3 | No-op restart | Unchanged corpus: start to ready ≤ 2 s and ≤ 1 CPU-second, zero file-level writes (DB and WAL size, mtime, hash) and no `Open` recycle. Measured with `serve --exit-after-warm` on a copy; fingerprint is `OpenReadOnly`. |
| B4 | Backfill memory | On a 2 GiB synthetic corpus, peak RSS ≤ 350 MB, sampled every 200 ms, with the shipped 256 MB / 244 MiB DuckDB cap. |
| B5 | No temp spill | No `<db>.tmp` directory or files under DuckDB `temp_directory` at any point, checked every 500 ms during first import. |
| B6 | Reads under load | 60 s, 8 concurrent readers hit every GET endpoint at 4 Hz while OTLP replays 50 batches/s and a backfill runs. A Reopen is triggered in-window (`AFTERTRACE_REOPEN`). Every response 200; no 5xx, no `database is closed`, no 503. |
| B7 | Counts with duplicates | Replay each batch 3 times, shuffled. Rollups equal an INPUT oracle (unique keys and cost of the generated batches, not a recount of the DB under test). Compare spans, events, meta, llm/trace/session/day/model cost (float tolerance 1e-6). |
| B8 | Resume after crash | 10 × SIGKILL after N sessions (5–90% of the corpus), then restart. Full counts, cost sums, and per-session key hash match a clean import; no `history_files` row marked `imported` without span rows. Fingerprint is `OpenReadOnly`. |
| B9 | OTLP never lost silently | With store failure injected, exporters get HTTP 503 **and** gRPC UNAVAILABLE. After recovery the batch's **events** are present exactly once (spans already dedupe on their primary key). |
| B10 | API latency | Existing `internal/perf` budget: p95 < 100 ms target, < 300 ms hard. Kept as-is in the Ubuntu Go job; the harness also reports p95 on its corpus. |

## Baselines from main — round 2 (this PR)

Measured on **linux/amd64** against the shipped engine (`memory_limit=256MB` = 244 MiB, unchanged). Command: `gen-history --size 2GiB --sessions 3000 --seed 42`. JSONL **3.06 GiB** (3 288 020 107 bytes). After import: DuckDB **410 MiB** (429 404 160 bytes), **574 212** spans, **194 604** events. First import **35 m 31 s** wall, **2630 CPU-s**, peak RSS **596.3 MB**. Idle is three **10-minute** client scenarios plus **2-minute** isolation windows. Git SHA of the tree this run compiled was `d238728` plus the round-2 harness (report-only).

WINDOW CLOSED is the B1 gate. Findings are a side effect of glance/status/overview, not a poll.

| ID | Measured | Corpus / window | vs target |
|---|---|---|---|
| B1 | **53.83 CPU-s** in 10 min WINDOW CLOSED (quota 3.000). 600 supervisor health hits, 10 tray health+glance hits. Electron main: **TODO**. | 2 GiB JSONL, 10 min closed | **miss** |
| B1b | **90.71 CPU-s** WINDOW OPEN IDLE (status 15 s, home 30 s, tray 45 s). | 2 GiB, 10 min | report (over quota 3) |
| B1c | **87.67 CPU-s** LIVE (home 4 s, session 5 s, popover 12 s). | 2 GiB, 10 min | report (over quota 3) |
| B2 | DB **479 MiB**, size and mtime unchanged during the closed window. No WAL. | 2 GiB, 10 min closed | pass |
| B3 | Restart `--exit-after-warm` **did not exit in 10 min** (history re-walk / rollup rebuild; idle log also hit `duplicate key` on `llm_facts`). On 32 MiB the same restart wrote the file (11.3 → 17.1 MB hash change, 32.5 s, 44 CPU-s). | 2 GiB copy, `--exit-after-warm` | **miss** |
| B4 | Peak RSS **596.3 MB**. Start-to-warm **2131 s** wall, **2630 CPU-s**. DSN `memory_limit=256MB` (244 MiB). | 2 GiB JSONL, 574 212 spans | **miss** |
| B5 | **0** spill hits, sampled every 500 ms for the whole import. | 2 GiB, 35 m 31 s import | pass |
| B6 | 60 s: **1078** × 200, **0** × 5xx, **0** closed, **27 662** transport errors. `AFTERTRACE_REOPEN` did **not** fire in-window (`reopened=false`): Reopen waits on the import write lock. | 2 GiB + OTLP 50/s, 60 s | **miss** |
| B7 | 40 batches × 3: unique input wants 80 spans / 40 events / 0.40 cost. Got events **120**, `meta.spans` **240**, `source_stats` **240**, trace/session/day cost **0**. | 40 OTLP batches × 3 | **miss** |
| B8 | **3/10** matched the clean import (574 212 spans, session hash). **7/10** left one `history_files` row imported without rows (157–226 spans short). SIGKILL at 5–90% of the 35 m 31 s golden import; size and session count recorded at kill. Trials 0–1 reused leftover crash DBs from an aborted run (recorded 2999 sessions); trials 2–6 are mid-import misses. | 2 GiB, 10 SIGKILL trials | **miss** |
| B9 | During injected failure: HTTP **400**, gRPC **Unknown**. After recovery: HTTP 200 and **1** event row. Fails the 503 **AND** UNAVAILABLE gate. | empty store + sentinel | **miss** |
| B10 | Harness p95 after idle: overview **0.18 ms**, status **0.18 ms**, findings **0.17 ms**, all under 300 ms. | 2 GiB after 30 min idle / 92k `internal/perf` | pass on this corpus; 92k gate kept |

Per-endpoint isolation CPU (engine process, 2 min, one route every 1 s):

| Endpoint | Path | CPU-s / 2 min |
|---|---|---|
| health | `/api/health` | **0.030** |
| glance | `/api/glance` | **24.62** |
| status | `/api/status` | **35.45** |
| overview | `/api/overview` | **24.30** |
| sessions | `/api/sessions` | **0.090** |

Glance/status/overview pay for the findings refresh. Health and sessions do not.

## Baselines from main — round 1, 2 GiB / 10-minute idle (superseded)

Round 1 polled `/api/findings` every 30 s. No real client does that. B3 only counted data-table rows via `store.Open` (which writes). B7's oracle recounted the DB under test. B9 used OR and span PK. B8 used random wall-clock kills and ignored fingerprint errors. Do not use these rows as the ratchet.

Measured on **linux/amd64** against the shipped engine (`memory_limit=256MB` = 244 MiB, unchanged from `main` at `d723d04`) by `internal/harness` profile `full`. Command: `gen-history --size 2GiB --sessions 3000 --seed 42`. JSONL on disk **3.06 GiB** (3 288 020 107 bytes). After import: DuckDB **205.5 MiB** (215 494 656 bytes), **574 212** spans, **194 604** events, **3 300** `history_files` imported. First import start-to-warm **26 m 17 s** wall, **2115.9 CPU-s**. Idle window **10 minutes** with the tray stand-in. Crash trials: **10**, SIGKILL 1.4–4.9 minutes into import.

This is the row that can speak to the field bug. The 32 MiB / 20 s table below cannot.

| ID | Measured | Corpus / window | vs target |
|---|---|---|---|
| B1 | **99.09 CPU-s** in 10 min idle (quota 3.000). 600 health hits, 14 glance hits, 20 findings hits. Electron main: **TODO** (not started). | 2 GiB JSONL, 205.5 MiB DB, 10 min idle, tray stand-in | miss |
| B2 | DB **205.5 MiB**, size and mtime unchanged. No WAL file. | 2 GiB JSONL, 10 min idle, tray stand-in | pass |
| B3 | **1.825 s** wall, **2.362 CPU-s**, data-table fingerprint unchanged (574 212 spans, 194 604 events, 3 300 imported files). | 2 GiB unchanged, `--exit-after-warm` | miss (CPU over 1 s; wall under 2 s) |
| B4 | Peak RSS **565.0 MB** during first import (sampled every 200 ms). Start-to-warm **1576.7 s** wall, **2115.9 CPU-s**. DSN `memory_limit=256MB` (244 MiB). | 2 GiB JSONL, 574 212 spans | miss |
| B5 | **0** spill hits (`<db>.tmp` / DuckDB temp files), sampled every 500 ms for the whole 26 m import. | 2 GiB JSONL, 26 m 17 s import | pass |
| B6 | 60 s: **6450** × 200, **0** × 5xx, **0** `database is closed`, **0** × 503, **0** transport errors. The 60 s window is the first minute of a 26-minute import, so this run never overlapped `Reopen`. | 2 GiB + live OTLP at 50 batches/s, 60 s | pass (does not include `Reopen`) |
| B7 | 40 batches × 3 shuffled: raw spans **80**, `meta.spans` **240**, `source_stats.spans` **240**. Oracle cost 0.40 matches `llm_facts` within 1e-9. | 40 OTLP batches × 3, empty store | miss (known double-count) |
| B8 | **1/10** trials matched the clean import (574 212 spans). **9/10** left one `history_files` row marked imported without rows and finished 145–226 spans short. | 2 GiB JSONL, 10 SIGKILL trials (1.4–4.9 min) | miss |
| B9 | During injected failure: HTTP **400** `injected store failure`, gRPC **Unknown** (not UNAVAILABLE). After removing the sentinel: HTTP 200 and **2** span rows (exactly once). | empty store + sentinel | miss (wrong status; data not lost) |
| B10 | Harness p95 after the 10 min idle (findings cache hot): overview **0.17 ms**, sessions **0.30 ms**, findings **0.12 ms**, all under 300 ms. The Ubuntu `AFTERTRACE_PERF=1` job still gates the 92k-span seed at p95 under 300 ms (target 100 ms). | 2 GiB harness after 10 min idle / 92k `internal/perf` | pass on this corpus; 92k gate kept |

## Baselines from main — 32 MiB / 20 s idle (not representative)

Measured by the round-2 harness on **linux/amd64**. **Corpus: 32 MiB, 80 sessions, seed 42**. Three **20 s** client scenarios plus **8 s** isolation. Crash trials: **10**, SIGKILL at 5–90% of golden import. B7/B9 use a dedicated empty store plus OTLP. macos-latest PR CI re-measures this profile. **Do not treat a pass here as evidence about the 244 MiB DuckDB cap, the 735 MB field DB, or a 10-minute hidden-window idle.**

| ID | Measured | Corpus / window | vs target |
|---|---|---|---|
| B1 | **0.250 CPU-s** in 20 s WINDOW CLOSED (quota 0.100). 20 health hits, 1 tray glance (findings as a side effect). | 32 MiB, 20 s closed | miss, **not representative** |
| B2 | DB **16.3 MB**, size and mtime unchanged. | 32 MiB, 20 s closed | pass, **not representative** |
| B3 | **32.5 s** wall, **44.1 CPU-s**, file wrote 11.3 → 17.1 MB (hash change). Recycle logged. | 32 MiB `--exit-after-warm` | **miss** (was a false green when B3 only counted data-table rows) |
| B4 | Peak RSS **253.2 MB**. | 32 MiB | pass, **not representative** |
| B5 | **0** spill hits. | 32 MiB | pass, **not representative** |
| B6 | 60 s: **588** × 200, **490** × 5xx, **1** `database is closed`, **51** transport errors. `reopened=true`. | 32 MiB + OTLP + forced Reopen | **miss** |
| B7 | 20 batches × 3: events **120** vs unique **20**, `meta.spans` **240** vs **40**, trace/session/day cost **0** vs **0.20**. | 20 OTLP batches × 3 | **miss** |
| B8 | 2/10 matched the clean import (14 936 spans). 8/10 left imported-without-rows. | 32 MiB, 10 SIGKILL at 5–90% of import | miss, **not representative** |
| B9 | HTTP **400** AND gRPC **Unknown**; after recovery **2** event rows on this corpus. | empty store + sentinel | **miss** |
| B10 | p95 overview **0.14 ms**, sessions **0.20 ms**. | 32 MiB | pass, **not representative** |

Electron main CPU: **TODO** (not started in CI). `powermetrics`: **TODO** on GitHub-hosted runners unless passwordless sudo works; nightly tries and logs the outcome.

## Audit bugs the later PRs flip to `t.Fatal`

Recorded as skip/`known bug` today, matching the current engine:

1. Duplicate OTLP batch: 2 span rows, 2 event rows, `meta.spans=4`, `source_stats.spans=4`.
2. Duplicate `api_request` then `EnsureRollups` after emptying `trace_roots`: `duplicate key "t1, llm"`, `llm_facts` cost 0, `trace_roots` 0.
3. `Reopen` vs concurrent reads: on the order of 800 queries, ~797 fail with `sql: database is closed` (or panic if `DB` is nil mid-recycle). Skipped under `-race` so default CI stays green.
