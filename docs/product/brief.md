# Product brief

Aftertrace is the flight recorder for your AI work. It shows, live and on your own machine, what your coding agents, your personal agents and the apps you build with LLMs are doing, where the time and money go, and the one change worth making next.

This brief is the plan of record for v0.1. It is written for contributors as much as for the maintainer.

## Who it is for

**The solo AI builder.** One person who builds a lot with AI:

- runs Claude Code most of the day, often three or four sessions at once;
- ships side projects that call the Claude API (or OpenAI, or Gemini);
- has a personal agent or two on a schedule: a nightly summarizer, an Agent SDK script, an MCP server;
- pays for a plan and some API usage, and wants both to be worth it.

They are not a platform team. They do not run evals, curate datasets or manage prompt versions. They want to know what happened, what it cost, and what to change, without standing up infrastructure.

## The questions, ranked

From user research (Hacker News and GitHub threads, issue trackers of the tools below, and our own use). The first four are where Aftertrace leads.

1. **Which of my running sessions needs me right now, and what is each one doing?** Parallel sessions are normal. Nothing shows them side by side.
2. **Where did my time go?** Waiting on me (permission prompts), on tools (tests, builds), on the model, on retries. Every other tool counts tokens; time is the experience.
3. **What did the agent actually do?** The prompt, every model reply, every command and its output, in order. Trust and debugging both start here.
4. **What one change saves the most, and did it work?** A finding with a quantified impact, an action, and a ledger of what fixing it saved.
5. **What ate my money?** By session, project, model, skill, subagent, MCP server.
6. **Is my plan worth it?** API-equivalent value against what I pay. The number people share.
7. **What do my own apps cost to run, per feature, and how fast are they?**
8. **Did my nightly agent run, what did it cost, and why did it fail?**
9. **Across every machine I use**, not just this laptop, and for longer than the 30 days Claude Code keeps transcripts.

We deliberately leave out evals, datasets, prompt registries, annotation queues, SLOs, RBAC and SSO. If one eval-like feature earns a place later it is "re-run this turn on a cheaper model and compare".

## Where we fit

Claude Code's `/usage` now attributes spend to skills, subagents and MCP servers and offers fixes. Transcript readers like ccusage and CodeBurn give fast cost breakdowns with zero setup. Team platforms (Langfuse, LangSmith, Braintrust, Phoenix) cover production LLM apps.

Aftertrace is not a better cost table. It wins on what those cannot do:

| | Aftertrace | Transcript readers | `/usage` | Team LLM platforms |
| - | - | - | - | - |
| Time, not just tokens (waiting on you, tools, retries) | Yes, from spans | No | Partly | Latency only |
| Live view of parallel sessions | Yes | No | No | No |
| Coding agents, your apps and personal agents in one place | Yes, OTLP | Coding agents | Claude Code | Apps |
| History beyond 30 days, across machines | Yes, push to one store | One machine | 7 days | Yes, hosted |
| Setup | One binary, one settings block | `npx` | Built in | SDK plus a service |
| Data leaves your machine | Never (Ask is opt-in) | No | No | Yes |

## What v0.1 ships

| Area | What it does | Answers |
| - | - | - |
| **Home** | One sentence about your week, a strip of numbers, live lanes for running sessions, the top finding, recent work | 1, 2, 4, 6 |
| **Live lanes** | One lane per running session: what it is doing, for how long, what it has cost, and when it has gone quiet | 1 |
| **Sessions and turns** | Every session, titled by its first prompt; every turn, labelled by its prompt | 3, 5 |
| **Trace** | Waterfall with a resizable inspector; a transcript of the turn; real input and output per span | 2, 3 |
| **Findings** | Ranked by impact, each with evidence, a fix to copy, and a savings ledger once resolved | 4 |
| **Cost** | Spend by model, skill, subagent, MCP server, tool, repo, source | 5 |
| **Apps** | Your own services sending OpenTelemetry GenAI spans: calls, cost, latency, errors, per operation | 7, 8 |
| **Connect** | One page per source with the snippet to copy, and live confirmation when the first span lands | setup |
| **Recap** | A weekly receipt: hours of agent work, API-equivalent value against your plan, what fixes saved; copy as image | 6 |
| **Query and Ask** | Builder, SQL, and plain-English questions answered with SQL (opt-in, sends only schema and rows) | any |

Later: quota and rate-limit forecasting, desktop notifications for runaway agents, a menu bar companion, Codex and Gemini CLI as first-class sources, authenticated multi-machine mode.

## Measures of success

- Time from install to first span on screen: under two minutes.
- The Home page answers "what happened today" without a click.
- At least one finding a week that a user acts on, and the ledger shows what it saved.
- People screenshot the recap.

See [design.md](design.md) for how it looks and behaves.
