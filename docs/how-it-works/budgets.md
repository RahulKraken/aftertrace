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

`serve --exit-after-warm` exits after history import, compact, rollups and reopen. `AFTERTRACE_FAIL_STORE` is a sentinel path Insert checks only when set; unset in production.

Profiles:

| Profile | JSONL size | Sessions | Idle | Crash trials | Where |
|---|---|---|---|---|---|
| `ci` | 32 MiB | 80 | 20 s | 10 (kill 50–1500 ms) | PR `scale` job on macos-14, ~15 min |
| `nightly` | 512 MiB | 800 | 10 min | 10 | `nightly.yml` |
| `full` | 2 GiB | 3000 | 10 min | 10 (kill 5–90% of golden import, capped at 5 min) | local / CI `workflow_dispatch` |

CI `workflow_dispatch` runs only the scale job and accepts `profile`, `corpus`, `sessions`, `idle`, and `crash_trials`. Empty inputs keep the profile defaults. PR CI keeps the small corpus so the job stays around 15 minutes.

B1/B2 drive a test-only tray stand-in when the desktop is not present: `GET /api/health` every 1 s, glance every 45 s (`IDLE_MS` in `desktop/src/tray.js`), findings every 30 s (status cache). Electron main-process CPU and `powermetrics` need a packaged desktop or a self-hosted Mac with sudo; both are TODOs on GitHub-hosted runners.

## Targets

| ID | Budget | Target |
|---|---|---|
| B1 | Idle engine CPU | About 0. At most 3 CPU-seconds in 10 minutes with the app open, window hidden, no incoming data. Sample `ps -o time` / `/proc/<pid>/stat` every 1 s. Electron main ≤ 2 CPU-seconds (TODO in CI). |
| B2 | Idle disk writes | 0. DB file and WAL size and mtime unchanged during the idle window. |
| B3 | No-op restart | Unchanged corpus: start to ready ≤ 2 s and ≤ 1 CPU-second, zero writes to data tables. Measured with `serve --exit-after-warm`. |
| B4 | Backfill memory | On a 2 GiB synthetic corpus, peak RSS ≤ 350 MB, sampled every 200 ms, with the shipped 256 MB / 244 MiB DuckDB cap. |
| B5 | No temp spill | No `<db>.tmp` directory or files under DuckDB `temp_directory` at any point, checked every 500 ms during first import. |
| B6 | Reads under load | 60 s, 8 concurrent readers hit every GET endpoint at 4 Hz while OTLP replays 50 batches/s and a backfill runs. Every response 200; no 5xx, no `database is closed`, no 503. |
| B7 | Counts with duplicates | Replay each batch 3 times, shuffled. Rollups and counters equal a from-scratch Go oracle on the raw tables; cost within 1e-9. |
| B8 | Resume after crash | 10 × SIGKILL at a random point during backfill, then restart. Final counts match a clean import; no `history_files` row marked `imported` without span rows. |
| B9 | OTLP never lost silently | With store failure injected, exporters get 503 or UNAVAILABLE and retry. After recovery the batch is present exactly once. |
| B10 | API latency | Existing `internal/perf` budget: p95 < 100 ms target, < 300 ms hard. Kept as-is in the Ubuntu Go job; the harness also reports p95 on its corpus. |

## Baselines from main — 2 GiB / 10-minute idle

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

Measured on `main` at `d723d04` by `internal/harness` on **linux/amd64**. **Corpus: 32 MiB, 80 sessions, seed 42**. Idle window **20 s**. Crash trials: **10**, kill 50–1500 ms. B7/B9 use a dedicated empty store plus OTLP. macos-14 PR CI re-measures this profile. **Do not treat a pass here as evidence about the 244 MiB DuckDB cap, the 735 MB field DB, or a 10-minute hidden-window idle.**

| ID | Measured | Corpus / window | vs target |
|---|---|---|---|
| B1 | **0.000 CPU-s** in 20 s idle (window quota 0.100 CPU-s; 10-minute cap is 3 CPU-s). Below one `CLK_TCK` tick. No tray stand-in, so glance (45 s) and findings (30 s) never ran. Electron main: **TODO**. | 32 MiB, 20 s idle | pass, **not representative** |
| B2 | DB **4.73 MB**, size and mtime unchanged. No WAL file. | 32 MiB, 20 s idle | pass, **not representative** |
| B3 | **95 ms** wall, **0.097 CPU-s**, data-table fingerprint unchanged (1040 spans, 448 events, 88 imported files). | 32 MiB unchanged | pass, **not representative** |
| B4 | Peak RSS **136.2 MB** during first import. Far below the 244 MiB DuckDB cap. | 32 MiB | pass, **not representative** |
| B5 | **0** spill hits, sampled every 500 ms. | 32 MiB | pass, **not representative** |
| B6 | 60 s: **2926** × 200, **1** × 5xx, **1** `database is closed`, **0** × 503, **25678** transport errors (timeouts / reset while ingest and `Reopen` run). On this corpus the 60 s window covers the whole import including `Reopen`. | 32 MiB + live OTLP at 50 batches/s, 60 s | miss |
| B7 | 20 batches × 3 shuffled: raw spans **40**, `meta.spans` **120**, `source_stats.spans` **120**. Oracle cost 0.20 matches `llm_facts` within 1e-9. | 20 OTLP batches × 3 | miss (known double-count) |
| B8 | 2/10 trials matched the clean import (1040 spans). 8/10 left `history_files` marked imported without rows (1–2 files). | 32 MiB, 10 SIGKILL trials at 50–1500 ms | miss, **not representative** of a mid-backfill kill on 2 GiB |
| B9 | During injected failure: HTTP **400** `injected store failure`, gRPC **Unknown** (not UNAVAILABLE). After removing the sentinel: HTTP 200 and **2** span rows (exactly once). | empty store + sentinel | miss (wrong status; data not lost) |
| B10 | Harness p95 on 32 MiB history: overview **0.12 ms**, others under 0.1 ms. | 32 MiB harness / 92k `internal/perf` | pass, **not representative** of the 2 GiB corpus |

Electron main CPU: **TODO** (not started in CI). `powermetrics`: **TODO** on GitHub-hosted runners unless passwordless sudo works; nightly tries and logs the outcome.

## Audit bugs the later PRs flip to `t.Fatal`

Recorded as skip/`known bug` today, matching the current engine:

1. Duplicate OTLP batch: 2 span rows, 2 event rows, `meta.spans=4`, `source_stats.spans=4`.
2. Duplicate `api_request` then `EnsureRollups` after emptying `trace_roots`: `duplicate key "t1, llm"`, `llm_facts` cost 0, `trace_roots` 0.
3. `Reopen` vs concurrent reads: on the order of 800 queries, ~797 fail with `sql: database is closed` (or panic if `DB` is nil mid-recycle). Skipped under `-race` so default CI stays green.
