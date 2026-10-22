# Changelog

## Unreleased

- `aftertrace service install|uninstall|status`: keep `aftertrace serve` running at login as a LaunchAgent (macOS) or a systemd user unit (Linux), with the flags you pass. It prints every file and command first; `--dry-run` stops there. Logs go to `~/.aftertrace/serve.log`.
- Connect suggests the service when the server is not running as one. `/api/status` reports `info.service`.
- `scripts/homebrew-formula.sh` prints a Homebrew formula for a release.

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
