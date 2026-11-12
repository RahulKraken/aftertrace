# Scale and energy budgets

Report-only numbers for the engine. A miss does not fail CI. Later PRs turn each row into a hard gate. The harness lives in `internal/harness` and drives a real `aftertrace serve` process. Audit reproductions in `internal/store/audit_test.go` log `known bug` and skip instead of failing.

## How to run

```
# Hidden corpus generator (Claude Code ~/.claude/projects JSONL).
aftertrace dev gen-history --size 2GiB --sessions 3000 --seed 42 --dir /tmp/projects

# Full local run (2 GiB, 10-minute idle, 10 crash trials).
AFTERTRACE_HARNESS=1 AFTERTRACE_HARNESS_PROFILE=full go test -count=1 -timeout 2h ./internal/harness -run TestScaleBudgets -v

# CI-shaped run (32 MiB, 80 sessions, 20 s idle, 10 crash trials).
AFTERTRACE_HARNESS=1 AFTERTRACE_HARNESS_PROFILE=ci go test -count=1 -timeout 20m ./internal/harness -run TestScaleBudgets -v
```

`serve --exit-after-warm` exits after history import, compact, rollups and reopen. `AFTERTRACE_FAIL_STORE` is a sentinel path Insert checks only when set; unset in production.

The GitHub `scale` job on `macos-14` is about 15 minutes and uses the **32 MiB / 80 session / seed 42** corpus so a 2 GiB tree does not blow the job budget. Nightly (`nightly.yml`) uses that same 32 MiB tree with a **10-minute idle**. Electron main-process CPU and `powermetrics` need a packaged desktop or a self-hosted Mac with sudo; both are TODOs on GitHub-hosted runners.

## Targets

| ID | Budget | Target |
|---|---|---|
| B1 | Idle engine CPU | About 0. At most 3 CPU-seconds in 10 minutes with the app open, window hidden, no incoming data. Sample `ps -o time` / `/proc/<pid>/stat` every 1 s. Electron main ≤ 2 CPU-seconds (TODO in CI). |
| B2 | Idle disk writes | 0. DB file and WAL size and mtime unchanged during the idle window. |
| B3 | No-op restart | Unchanged corpus: start to ready ≤ 2 s and ≤ 1 CPU-second, zero writes to data tables. Measured with `serve --exit-after-warm`. |
| B4 | Backfill memory | On a 2 GiB synthetic corpus, peak RSS ≤ 350 MB, sampled every 200 ms. CI reports the 32 MiB corpus. |
| B5 | No temp spill | No `<db>.tmp` directory or files under DuckDB `temp_directory` at any point, checked every 500 ms. |
| B6 | Reads under load | 60 s, 8 concurrent readers hit every GET endpoint at 4 Hz while OTLP replays 50 batches/s and a backfill runs. Every response 200; no 5xx, no `database is closed`, no 503. |
| B7 | Counts with duplicates | Replay each batch 3 times, shuffled. Rollups and counters equal a from-scratch Go oracle on the raw tables; cost within 1e-9. |
| B8 | Resume after crash | 10 × SIGKILL at a random point during backfill, then restart. Final counts match a clean import; no `history_files` row marked `imported` without span rows. |
| B9 | OTLP never lost silently | With store failure injected, exporters get 503 or UNAVAILABLE and retry. After recovery the batch is present exactly once. |
| B10 | API latency | Existing `internal/perf` budget: p95 < 100 ms target, < 300 ms hard. Kept as-is in the Ubuntu Go job; the harness also reports p95 on its corpus. |

## Baselines from main

Measured on `main` at `d723d04` (engine path unchanged aside from the test flag and the no-op `AFTERTRACE_FAIL_STORE` hook) by `internal/harness` on **linux/amd64**. **Corpus: 32 MiB, 80 sessions, seed 42** for B1–B6, B8 and B10. Idle window **20 s** (nightly is 10 minutes). Crash trials: **10**. B7/B9 use a dedicated empty store plus OTLP. macos-14 CI will re-measure the same profile.

| ID | Measured on main | Corpus | vs target |
|---|---|---|---|
| B1 | **0.000 CPU-s** in 20 s idle (window quota 0.100 CPU-s; 10-minute cap is 3 CPU-s). Below one `CLK_TCK` tick. Electron main: **TODO** (not started). | 32 MiB, 20 s idle | pass (short window) |
| B2 | DB **4.73 MB**, size and mtime unchanged. No WAL file. | 32 MiB, 20 s idle | pass |
| B3 | **95 ms** wall, **0.097 CPU-s**, data-table fingerprint unchanged (1040 spans, 448 events, 88 imported files). | 32 MiB unchanged | pass |
| B4 | Peak RSS **136.2 MB** during first import. 2 GiB corpus not run here (CI/nightly use 32 MiB). | 32 MiB | pass on this corpus; 2 GiB unmeasured |
| B5 | **0** spill hits (`<db>.tmp` / DuckDB temp files), sampled every 500 ms. | 32 MiB | pass |
| B6 | 60 s: **2926** × 200, **1** × 5xx, **1** `database is closed`, **0** × 503, **25678** transport errors (timeouts / reset while ingest and `Reopen` run). | 32 MiB + live OTLP at 50 batches/s | miss |
| B7 | 20 batches × 3 shuffled: raw spans **40**, `meta.spans` **120**, `source_stats.spans` **120**. Oracle cost 0.20 matches `llm_facts` within 1e-9. | 20 OTLP batches × 3 | miss (known double-count) |
| B8 | 2/10 trials matched the clean import (1040 spans). 8/10 left `history_files` marked imported without rows (1–2 files). | 32 MiB, 10 SIGKILL trials | miss |
| B9 | During injected failure: HTTP **400** `injected store failure`, gRPC **Unknown** (not UNAVAILABLE). After removing the sentinel: HTTP 200 and **2** span rows (exactly once). | empty store + sentinel | miss (wrong status; data not lost) |
| B10 | Harness p95 on 32 MiB history: overview **0.12 ms**, others under 0.1 ms. The Ubuntu `AFTERTRACE_PERF=1` job still gates the 92k-span seed at p95 under 300 ms (target 100 ms). | 32 MiB harness / 92k `internal/perf` | pass on 32 MiB; 92k gate kept |

Electron main CPU: **TODO** (not started in CI). `powermetrics`: **TODO** on GitHub-hosted runners unless passwordless sudo works; nightly tries and logs the outcome.

## Audit bugs the later PRs flip to `t.Fatal`

Recorded as skip/`known bug` today, matching the current engine:

1. Duplicate OTLP batch: 2 span rows, 2 event rows, `meta.spans=4`, `source_stats.spans=4`.
2. Duplicate `api_request` then `EnsureRollups` after emptying `trace_roots`: `duplicate key "t1, llm"`, `llm_facts` cost 0, `trace_roots` 0.
3. `Reopen` vs concurrent reads: on the order of 800 queries, ~797 fail with `sql: database is closed` (or panic if `DB` is nil mid-recycle). Skipped under `-race` so default CI stays green.
