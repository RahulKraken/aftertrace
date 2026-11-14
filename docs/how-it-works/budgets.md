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
AFTERTRACE_HARNESS=1 AFTERTRACE_HARNESS_PROFILE=nightly go test -count=1 -timeout 5h ./internal/harness -run TestScaleBudgets -v

# PR CI-shaped run (32 MiB, 80 sessions, 20 s idle, 10 crash trials). Not representative.
AFTERTRACE_HARNESS=1 AFTERTRACE_HARNESS_PROFILE=ci go test -count=1 -timeout 20m ./internal/harness -run TestScaleBudgets -v
```

`serve --exit-after-warm` exits after history import, compact, rollups and reopen.

Each run uses a fresh `run-<UTC timestamp>` subdirectory under `AFTERTRACE_HARNESS_OUT` (or `t.TempDir()`). `copyDB` deletes the destination DB and `.wal` then streams with `io.Copy`. B8 crash dirs are removed before each trial.

## Test hooks

Compiled only with `go build -tags harness` (the harness `BuildBin` path). A production `go build ./cmd/aftertrace` does not include them.

| Env | What |
|---|---|
| `AFTERTRACE_HARNESS=1` | Enables `TestScaleBudgets` (skip otherwise). Does not change the shipped DSN. |
| `AFTERTRACE_REOPEN` | Sentinel path. When the file appears, serve calls `Store.Reopen` once and removes it. B6. |
| `AFTERTRACE_PPROF=1` | Serves `/debug/pprof/` with `pprof.Do` **route-template** labels from the API mux (`mux.Handler`, e.g. `GET /api/session/{id}`), not the pprof wrapper's `/` catch-all. Origin must be empty (local curl) or a localhost hostname; Host must be 127.0.0.1 / localhost / ::1. |
| `AFTERTRACE_FAIL_STORE` | Sentinel path captured at `store.Open`. Insert fails while the file exists. Always compiled (audit tests use it); not a pprof/reopen hook. |
| `AFTERTRACE_HARNESS_ONLY` | Comma-separated budget ids (`B3,B4,B5,B8`) to run a subset. |
| `AFTERTRACE_HARNESS_RATCHET=0` | Skip the baseline check. |

Profiles:

| Profile | JSONL size | Sessions | Idle | Isolation | Crash trials | Where |
|---|---|---|---|---|---|---|
| `ci` | 32 MiB | 80 | 20 s × 3 scenarios | 8 s / endpoint | 10 (SIGKILL after 5–90% of golden **session count**) | PR `scale` job on macos-latest, ~15 min |
| `nightly` | 512 MiB | 800 | 10 min × 3 | 2 min / endpoint; pprof 120 s | 10 | `nightly.yml` daily schedule |
| `full` | 2 GiB | 3000 | 10 min × 3 | 2 min / endpoint; pprof 120 s | 10 | local / weekly Sunday schedule |

CI `workflow_dispatch` runs only the scale job and accepts `profile`, `corpus`, `sessions`, `idle`, and `crash_trials`. Empty inputs keep the profile defaults. PR CI keeps the small corpus so the job stays around 15 minutes.

Idle cadences are the real client timers (`internal/harness/cadence.go`). `TestCadencesMatchSources` greps `desktop/src/tray.js`, `desktop/src/engine.js`, `web/src/pages/HomePage.tsx`, `web/src/pages/SessionPage.tsx`, and `web/src/components/Shell.tsx`. Findings are never polled; they refresh as a side effect of glance/status/overview/session, at most every 30 s.

| Scenario | Who | Cadence | B1? |
|---|---|---|---|
| `window_closed` | supervisor `/api/health`; tray health then glance | 1 s; 60 s (`HIDDEN_MS`) | **yes, this is the gate** |
| `window_open_idle` | status; home overview+sessions; tray | 15 s; 30 s; 45 s (`IDLE_MS`) | report |
| `live` | status (every page); `/api/session/{id}`; popover | 15 s; 5 s; 12 s (`OPEN_MS`) | report. Does **not** poll home at the same time. |

Per-endpoint isolation CPU is a separate ~2-minute window (8 s in CI) that hits one route every 1 s and records the engine process's CPU change (`getrusage` / `ps` / `/proc/<pid>/stat`). A **no-traffic** window of the same length runs first. Drill-down is a CPU profile taken during a dedicated window-closed interval of **at least 120 s** on nightly/full (so a tray glance at `HIDDEN_MS=60s` is in the sample; CI stays 8 s). `go tool pprof -top -tags`; labels are API mux route templates (`mux.Handler`, e.g. `GET /api/glance`), not the pprof wrapper's `/` catch-all. The findings-refresh goroutine is labelled `findings-refresh`. Not `RUSAGE_THREAD`.

B1 is **Invalid** (not a miss) when the closed window's wall time is outside `[0.85, 1.25]×idle` or supervisor health hits are outside ±20% of idle seconds. B6 is **Invalid** when `AFTERTRACE_REOPEN` does not fire in-window (Reopen waits on the import write lock); transport error strings are recorded. Invalid results fail the ratchet and are never skipped.

`powermetrics` starts in the background for the WINDOW CLOSED idle window when `AFTERTRACE_POWERMETRICS=1` (nightly/weekly). It is launched with a fixed sample count (`-n`, window seconds + 15) so it exits on its own. Stop uses `sudo kill -INT` then `sudo kill -9` on **powermetrics' own PID**, not sudo's: the harness is a normal user, so a process-group SIGINT/SIGKILL only kills sudo and leaves the root child running (nightly 43478795531). Output is `run-<ts>/powermetrics.txt`, copied to `AFTERTRACE_HARNESS_OUT/powermetrics.txt` for the artifact glob. Electron main-process CPU still needs a packaged desktop or a self-hosted Mac with sudo.

Per-phase bounds (fail with a phase name, do not burn the job timeout):

| Phase | Bound |
|---|---|
| gen-history | wall of the generator (seconds) |
| first import / B8 restart | `ImportWait` (45 min nightly, 2 h full, 20 min CI) |
| B3 `--exit-after-warm` | min(10 min, `ImportWait`) |
| B8 kill wait | `ImportWait`, until N ingested sessions (heartbeat every 30 s) |
| window-closed / open-idle / live | `Idle` (10 min nightly) |
| powermetrics stop | `sudo kill -INT` on child PID, 5 s, then `sudo kill -9`; `-n` samples as backstop |
| isolation per endpoint | `Isolation` (2 min nightly) |
| pprof | 120 s nightly/full (8 s CI) + 30 s HTTP |
| B6 load window | `Load` (60 s) + 30 s Reopen wait |

## Ratchet

`internal/harness/testdata/baseline-<profile>.json` (`ci`, `nightly`, `full`) stores pass/fail plus resource numbers (`cpu_s`, `peak_rss_mb`, `hits`, `wall_s`) and a `goos`. Resource comparisons are skipped when the run's GOOS does not match the baseline (a Linux 2 GiB RSS must not fail the macOS 512 MiB memory ratchet). CI fails if a previously green budget turns red, a red budget flips green without a baseline update, a stored resource regresses by more than about 10% (including 0→positive), or any result is **Invalid**. Invalid is never skipped. Already-red correctness budgets stay red until their owner PR. `AFTERTRACE_HARNESS_RATCHET=0` skips the check.

The nightly ratchet is the green 512 MiB darwin run 43478795531 (B1 14.46 CPU-s, B4 358 MB), not the 2 GiB copy. The full ratchet is weekly darwin run 43510741168 (B1 67.79, B4 486.4).

| Budget | Owner PR | Gate |
|---|---|---|
| B3 no-op restart writes | PR 3 | resource, nightly/full |
| B6 reads under Reopen | PR 4 | correctness, PR |
| B1 idle CPU, B2 idle disk | PR 5 | resource, nightly/full |
| B7a late-arriving cost; B7b duplicate counts | PR 6 | correctness, PR. B7a is the same rollup/cost path: `refreshTraces` builds `trace_roots` when spans arrive and never reapplies a later `api_request` cost. |
| B9 OTLP 503/UNAVAILABLE | PR 7 | correctness, PR. Also owns a real failure-after-commit-plus-retry test; today's exactly-once check is trivial (fail path writes nothing). |
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
| B6 | Reads under load | 60 s, 8 concurrent readers hit every GET endpoint at 4 Hz while OTLP replays 50 batches/s and a backfill runs. A Reopen is triggered in-window (`AFTERTRACE_REOPEN`). Every response 200; no 5xx, no `database is closed`, no 503. If Reopen never fires (blocked behind the import lock), the row is **Invalid**, not a miss. |
| B7a | Late-arriving cost | Single copy: traces first, then `api_request` cost. Rollups equal the INPUT oracle, including trace/session/day cost. Owner: PR 6. |
| B7b | Counts with duplicates | Replay each batch 3 times, shuffled. Rollups equal an INPUT oracle (unique keys and cost of the generated batches, not a recount of the DB under test). Compare spans, events, meta, llm/trace/session/day/model cost (float tolerance 1e-6). Owner: PR 6. |
| B8 | Resume after crash | 10 × SIGKILL after N ingested sessions (5–90% of the golden distinct session count), then restart. Trials killed after ingest finished (session count ≥ golden) are **Invalid** and excluded. Report **matched/valid**. Full counts, cost sums, and per-session key hash match a clean import; no `history_files` row marked `imported` without span rows. Fingerprint is `OpenReadOnly`. |
| B9 | OTLP never lost silently | With store failure injected, exporters get HTTP 503 **and** gRPC UNAVAILABLE. After recovery the batch's **events** are present exactly once (spans already dedupe on their primary key). The exactly-once check is trivially true today; PR 7 owns a failure-after-commit-plus-retry test. |
| B10 | API latency | Existing `internal/perf` budget: p95 < 100 ms target, < 300 ms hard. Kept as-is in the Ubuntu Go job; the harness also reports p95 on its corpus. |

## Baselines from main — round 4 512 MiB nightly (darwin, run 43510617620)

Green [nightly 43510617620](https://github.com/RahulKraken/aftertrace/actions/runs/43510617620) on **darwin/arm64**, macos-latest, head `db64fd3`. Profile `nightly`: 512 MiB, 800 sessions, seed 42, 10-minute idle. `TestScaleBudgets` **PASS** in 6154.42 s. Artifact `nightly-budget-report` has **6 files**, including `powermetrics.txt` (3.3 MB) at the OUT root and under `run-20261113T212624Z/`. `powermetrics` sudo pid 80411 / child pid 80413, `-n` 615; stop used `sudo kill` on the child and `B1 closed` logged 0.17 s later.

Do **not** use hung run 43421664859 (B4 359.7 / B8 8 of 10 / B3 511 ms). The ratchet file is still green run [43478795531](https://github.com/RahulKraken/aftertrace/actions/runs/43478795531) (B1 14.46, B4 358.0, B3 450 ms / 0.547 CPU-s). That run's B8 wall-time 4/10 is **0/6** matched/valid once trials 6–9 (800/800 after ingest) are Invalid.

| ID | Measured | Corpus / window | Valid? | vs target |
|---|---|---|---|---|
| B1 | **14.350 CPU-s** in 600.009 s WINDOW CLOSED (quota 3.000). 601 supervisor health, 10 tray health+glance. Electron main: **TODO**. | 512 MiB JSONL, 10 min closed | Valid | **miss** |
| B2 | size and mtime unchanged. | 512 MiB, 10 min closed | Valid | pass |
| B3 | **298 ms** wall, **0.391 CPU-s**, writes=true. Owner PR 3. | 512 MiB copy, `--exit-after-warm` | Valid | **miss** (writes) |
| B4 | Peak RSS **354.3 MB**. | 512 MiB JSONL, 153 200 spans | Valid | **miss** |
| B5 | **0** spill hits. | 512 MiB, 3 m 19 s import | Valid | pass |
| B6 | n200=531, err=38, `reopened=true` (`/api/field-values` deadlines). | 512 MiB + OTLP + forced Reopen | Valid | **miss** |
| B7a | copies=1: trace/session/day cost **0 vs 0.20**. Owner PR 6. | 20 OTLP batches × 1 | Valid | **miss** |
| B7b | events **60 vs 20**. Owner PR 6. | 20 OTLP batches × 3 | Valid | **miss** |
| B8 | **2/10** matched/valid; **0 invalid**. Kills at 40–720 of 800 sessions. Trials 5 and 8 matched. | 512 MiB, 10 SIGKILL after N sessions | 10 valid / 0 invalid | **miss** |
| B9 | HTTP **400** AND gRPC **Unknown**; events=**1**. Owner PR 7. | empty store + sentinel | Valid | **miss** |
| B10 | p95 under 300 ms. | 512 MiB after idle | Valid | pass |

Isolation / 2 min: none **2.130**, health 0.060, glance 7.210, status 8.460, overview 5.990, sessions 0.170. Closed-window pprof **120 s**, labels **96.92% `findings-refresh`**. Open-idle **25.750 CPU-s** / 10 min. Live **32.130 CPU-s** / 10 min.

Nightly ratchet (`baseline-nightly.json`, `goos: darwin`) is 43478795531: B1 14.46, B4 358, B3 0.45 / 0.547. Linux runs skip the darwin resource keys.

## Baselines from main — round 4 weekly 2 GiB (darwin, run 43510741168)

Green [weekly 43510741168](https://github.com/RahulKraken/aftertrace/actions/runs/43510741168) on **darwin/arm64**, macos-latest, head `99d0e8a`. Profile `full`: 2 GiB, 3000 sessions, seed 42, 10-minute idle. Elapsed **5 h 4 m** (18223 s). Artifact `weekly-full-budget-report` has **6 files**, including `powermetrics.txt` (3.4 MB). Golden DuckDB **574 212** spans, **194 604** events (same as the linux 2 GiB corpus). First import **22 m 32 s**, peak RSS **486.4 MB**, 0 spill.

| ID | Measured | Corpus / window | Valid? | vs target |
|---|---|---|---|---|
| B1 | **67.79 CPU-s** in 600.004 s WINDOW CLOSED (quota 3.000). 601 supervisor health, 10 tray. | 2 GiB JSONL, 10 min closed | Valid | **miss** |
| B2 | size and mtime unchanged. | 2 GiB, 10 min closed | Valid | pass |
| B3 | **1.602 s** wall, **2.668 CPU-s**, writes=true. Owner PR 3. | 2 GiB copy, `--exit-after-warm` | Valid | **miss** |
| B4 | Peak RSS **486.4 MB**. | 2 GiB JSONL, 574 212 spans | Valid | **miss** |
| B5 | **0** spill hits. | 2 GiB, 22 m 32 s import | Valid | pass |
| B6 | n200=513, err=57, `reopened=true`. | 2 GiB + OTLP + forced Reopen | Valid | **miss** |
| B7a | copies=1: cost 0 vs **0.40**. Owner PR 6. | 40 OTLP batches × 1 | Valid | **miss** |
| B7b | events **120 vs 40**. Owner PR 6. | 40 OTLP batches × 3 | Valid | **miss** |
| B8 | **1/10** matched/valid; **0 invalid**. Kills at 150–2700 of 3000 sessions. Trial 9 (2700) matched. | 2 GiB, 10 SIGKILL after N sessions | 10 valid / 0 invalid | **miss** |
| B9 | HTTP **400** AND gRPC **Unknown**. Owner PR 7. | empty store + sentinel | Valid | **miss** |
| B10 | p95 under 300 ms. | 2 GiB after idle | Valid | pass |

Isolation / 2 min: none **1.15**, health 0.07, glance 29.72, status 39.46, overview 26.85, sessions 0.17. Closed-window pprof **120 s**, labels **97.85% `findings-refresh`**. Open-idle **110.54 CPU-s**. Live **150.12 CPU-s**.

Full ratchet (`baseline-full.json`) is this darwin run so a 4× RSS/CPU jump fails CI. Linux resource keys are skipped when `goos` does not match.

## Baselines from main — round 3 (this PR)

Clean `run-<timestamp>` directory. `copyDB` streams and drops a stale `.wal`. B7 is split into B7a (copies=1, late cost) and B7b (duplicates). Numbers below are filled after the clean-dir 2 GiB rerun and the B7a/B7b control on main.

Measured on **linux/amd64** against the shipped engine (`memory_limit=256MB` = 244 MiB, unchanged). Clean dir `run-20261113T034939Z`. JSONL **3.06 GiB** (3 288 020 107 bytes). Golden DuckDB **207 MiB** (216 805 376 bytes), **574 212** spans, **194 604** events. First import **24 m 57 s** wall, **2004 CPU-s**.

B3 in a clean dir is **not** a 10-minute re-import. Timestamped `b3-serve-20261113T041831Z.log` shows recycle + `duplicate key` on `llm_facts` and exit at 574 212 spans in **1.447 s**. The round-2 “still importing after 10 min” was leftover DBs in a reused OUT dir. Reviewer’s 0.3 s no-op at 512 MiB matches this order of magnitude.

| ID | Measured | Corpus / window | Valid? | vs target |
|---|---|---|---|---|
| B1 | **60.26 CPU-s** in 600.001 s WINDOW CLOSED (quota 3.000). 600 supervisor health hits, 10 tray health+glance. Electron main: **TODO**. | 2 GiB JSONL, 10 min closed | Valid | **miss** |
| B2 | DB **207 MiB**, size and mtime unchanged. No WAL. | 2 GiB, 10 min closed | Valid | pass |
| B3 | **1.447 s** wall, **2.157 CPU-s**, writes=true (size 216 805 376 unchanged; hash/mtime change; recycle logged twice). | 2 GiB copy, `--exit-after-warm` | Valid | **miss** (CPU > 1 s, writes) |
| B4 | Peak RSS **536.0 MB**. Start-to-warm **1497 s** wall, **2004 CPU-s**. | 2 GiB JSONL, 574 212 spans | Valid | **miss** |
| B5 | **0** spill hits, sampled every 500 ms for the whole import. | 2 GiB, 24 m 57 s import | Valid | pass |
| B6 | Not overlapped with the 2 GiB first import this round. Round-2 overlap: Reopen did not fire (`reopened=false`) → **Invalid**. After WaitWarm, 32 MiB/CI: `reopened=true` with `/api/cost` or `/api/field-values` deadlines. | 2 GiB overlap Invalid; 32 MiB Valid miss | | |
| B7a | copies=1, traces then logs: spans/events match (40/20). **trace/session/day cost 0 vs 0.20**. llm_facts 0.20. Owner PR 6 (`refreshTraces` never reapplies later `api_request` cost). | 20 OTLP batches × 1, empty store | Valid | **miss** |
| B7b | 20 batches × 3: events **60** vs unique **20**, `meta.spans` **120** vs **40**, plus the same cost=0. | 20 OTLP batches × 3, empty store | Valid | **miss** |
| B8 | **1/10** matched/valid (trial 6 at 61% / 2021 sessions). 9/10 left imported-without-rows (1–2 files, 163–235 spans short). Trials 0–1 killed at 188 and 499 sessions (not leftover DBs). All 10 were mid-import (sessions < 3000); 0 invalid. Wall-time % on this corpus happened to still be ingesting. | 2 GiB, 10 SIGKILL trials | 10 valid / 0 invalid | **miss** |
| B9 | HTTP **400** AND gRPC **Unknown**; events=**1** (trivial exactly-once). PR 7 owns failure-after-commit-plus-retry. | empty store + sentinel | Valid | **miss** |
| B10 | 32 MiB p95 under 300 ms. Not re-measured after the 2 GiB idle (ONLY=B1–B5,B8). | 32 MiB | Valid | pass on 32 MiB |

Per-endpoint isolation CPU (engine process, 2 min, one route every 1 s) plus a no-traffic window:

| Endpoint | Path | CPU-s / 2 min |
|---|---|---|
| none | (no traffic) | **0.000** |
| health | `/api/health` | **0.020** |
| glance | `/api/glance` | **26.27** |
| status | `/api/status` | **35.37** |
| overview | `/api/overview` | **25.32** |
| sessions | `/api/sessions` | **0.100** |

No-traffic is 0, so the 60.26 CPU-s closed window is not a hidden DuckDB worker. Health and sessions are cheap. Glance/status/overview pay for the 30 s findings cache. A 30 s window-closed CPU profile taken *after* isolation (cache hot, no glance in-window) recorded **0 samples**. A 30 s profile while hitting `/api/glance` on the same 2 GiB DB: **9.06 s** of samples (30% of wall); labels **91.9% `findings-refresh`**, 8.1% `/`; top `runtime.cgocall` 64%, `database/sql.(*DB).QueryContext` 56% cum, `api.buildGlance` 4.6% cum.

Open-idle **94.79 CPU-s** / 10 min (home 20, status 40, tray 14). Live **115.98 CPU-s** / 10 min (status 40, popover 50). Live did not hit `/api/session/{id}` on this corpus: `/api/sessions` is the full 3000-row list and can miss the 15 s HTTP timeout; sid is now resolved from glance/overview first.

## Baselines from main — round 2 (dirty OUT dir; superseded)

Round 2 reused `AFTERTRACE_HARNESS_OUT` across runs, so B8 trials 0–1 and probably B3/B4 saw leftover DBs. Do not use these rows as the ratchet. Kept for the review trail.

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

Measured by the round-3 harness on **linux/amd64**, clean `run-20261113T033901Z`. **Corpus: 32 MiB, 80 sessions, seed 42**. Three **20 s** client scenarios plus **8 s** isolation including a no-traffic window. Crash trials: **10**, SIGKILL at 5–90% of golden import wall. B7a/B7b/B9 use a dedicated empty store plus OTLP. macos-latest PR CI re-measures this profile. **Do not treat a pass here as evidence about the 244 MiB DuckDB cap, the 735 MB field DB, or a 10-minute hidden-window idle.**

| ID | Measured | Corpus / window | Valid? | vs target |
|---|---|---|---|---|
| B1 | **0.260 CPU-s** in 20.000 s WINDOW CLOSED (quota 0.100). 20 health hits, 1 tray glance. | 32 MiB, 20 s closed | Valid | miss, **not representative** |
| B2 | size and mtime unchanged. | 32 MiB, 20 s closed | Valid | pass, **not representative** |
| B3 | **0.168 s** wall, **0.157 CPU-s**, writes=true (7.9 → 8.4 MB hash change). Recycle logged. | 32 MiB `--exit-after-warm` | Valid | **miss** (writes) |
| B4 | Peak RSS **245.8 MB**. | 32 MiB | Valid | pass, **not representative** |
| B5 | **0** spill hits. | 32 MiB | Valid | pass, **not representative** |
| B6 | 60 s: **5606** × 200, **0** × 5xx, **0** closed, **4** transport errors (`/api/cost` deadline exceeded). `reopened=true`. | 32 MiB + OTLP + forced Reopen | Valid | **miss** |
| B7a | cost 0 vs 0.20 on trace/session/day. | 20 batches × 1 | Valid | **miss** |
| B7b | events 60 vs 20; meta.spans 120 vs 40; cost 0. | 20 batches × 3 | Valid | **miss** |
| B8 | 2/10 matched (14 936 spans). Trials 0–1 killed at 5 and 10 sessions. | 32 MiB, 10 SIGKILL at 5–90% of 32 s import | Valid | miss, **not representative** |
| B9 | HTTP **400** AND gRPC **Unknown**; after recovery **1** event row. | empty store + sentinel | Valid | **miss** |
| B10 | p95 under 300 ms. | 32 MiB | Valid | pass, **not representative** |

Isolation / 8 s: none **0.000**, health 0.010, glance 0.260, status 0.090, overview 0.040, sessions 0.000. Window-closed pprof (8 s): 0 samples (idle too quiet at this corpus).

Electron main CPU: **TODO** (not started in CI). `powermetrics`: **TODO** on GitHub-hosted runners unless passwordless sudo works; nightly tries and logs the outcome.

## Audit bugs the later PRs flip to `t.Fatal`

Recorded as skip/`known bug` today, matching the current engine:

1. Duplicate OTLP batch: 2 span rows, 2 event rows, `meta.spans=4`, `source_stats.spans=4`.
2. Duplicate `api_request` then `EnsureRollups` after emptying `trace_roots`: `duplicate key "t1, llm"`, `llm_facts` cost 0, `trace_roots` 0.
3. `Reopen` vs concurrent reads: on the order of 800 queries, ~797 fail with `sql: database is closed` (or panic if `DB` is nil mid-recycle). Skipped under `-race` so default CI stays green.
