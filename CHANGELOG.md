# Changelog

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
