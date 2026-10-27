# Privacy

> [How redaction works, with a figure →](how-it-works/redaction.md)

Aftertrace is local-first. The process never opens a network connection of its own. The only sockets are the ones you bind for OTLP and the UI.

## What is redacted by default

At ingest, `internal/redact` deletes keys from every span, span event, log record, and metric data point, including resource attributes.

Content keys, dropped unless `--store-content`. The full list is `ContentKeys` and `ContentPrefixes` in [`internal/redact/redact.go`](../internal/redact/redact.go):

```
Claude Code     user_prompt prompt prompt_text response response.model_output tool_input tool.output output new_context body
GenAI semconv   gen_ai.input.messages gen_ai.output.messages gen_ai.system_instructions gen_ai.tool.definitions
                gen_ai.tool.call.arguments gen_ai.tool.call.result gen_ai.retrieval.query.text gen_ai.retrieval.documents
                gen_ai.prompt gen_ai.completion gen_ai.request.stop_sequences  gen_ai.prompt.* gen_ai.completion.*
Claude SDK      anthropic.tool_result.content
OpenLLMetry     traceloop.entity.input traceloop.entity.output
OpenInference   input.value output.value llm.prompts llm.tools tool_call.function.arguments tool.parameters
                llm.input_messages.* llm.output_messages.*
Vercel AI SDK   ai.prompt ai.prompt.messages ai.response.text ai.response.toolCalls ai.response.reasoning ai.toolCall.args ai.toolCall.result
Pydantic AI     pydantic_ai.all_messages
Gemini CLI      request_text response_text function_args
```

Those names are the ones Claude Code uses for prompt text, responses, tool input, tool output, detailed-beta context, and raw API bodies. See [Claude Code monitoring](https://code.claude.com/docs/en/monitoring-usage). Local history import never reads those fields into the store at all, even with `--store-content`: it keeps timestamps, model, tokens, tool names, ids and durations.

Identity keys, **always** dropped, including with `--store-content`:

```
user.email
user.account_uuid
user.account_id
user.id
organization.id
process.owner
```

`user_prompt_length` and other non-content attributes are kept. Claude Code still has to send an attribute for Aftertrace to store it. Prompt text is off at the source unless you set `OTEL_LOG_USER_PROMPTS=1`; see [claude-code-setup.md](claude-code-setup.md#opting-into-content).

`OTEL_LOG_TOOL_DETAILS=1` is a separate gate. It sends Bash commands, file paths, and skill / MCP names. Those keys are **not** in the lists above, so Aftertrace stores them. That is why findings can name `Bash(npm test:*)`.

## `--store-content`

`aftertrace serve --store-content` and `aftertrace import --store-content` keep the content keys. Identity keys still go. The serve log line is:

```
redact=on store_content=false  (no telemetry)
```

`store_content=true` only after you pass the flag.

Two gates, both default off: Claude Code does not emit content, and Aftertrace deletes the keys if they arrive anyway.

## Localhost-only binding

`--listen` defaults to `127.0.0.1`. OTLP gRPC, OTLP HTTP, and the UI all bind that host. Nothing on the LAN can reach the receivers unless you pass `--listen 0.0.0.0`.

There is no TLS and no auth. Team mode on a shared host is a private network decision, not a Aftertrace feature.

## No telemetry, no phone-home

The binary does not check for updates, crash-report, or send usage. `POST /api/sql` is read-only and sandboxed. The one exception is Ask, which is off unless you turn it on.

## Ask

`aftertrace serve --ask` with `ANTHROPIC_API_KEY` set turns on plain-English questions on the Query page. Claude writes SQL, Aftertrace runs it in the sandbox below, and Claude answers from the rows. What leaves the machine, to the Anthropic API only:

- The question you typed.
- The schema: table and view columns, and the span and event names present with their counts.
- The rows of each query it runs, at most 50 per query, with every string cut to 200 characters.

The prompt tells Claude not to select prompt, response or tool content, and the 200-character cut keeps long content out even if it does. Nothing is sent when `--ask` is off, and the Query page says so. The model is `claude-opus-5-5` unless `AFTERTRACE_ASK_MODEL` names another.

## SQL sandbox

The Query page's raw SQL box runs your SQL on the store, so it is locked to the store. DuckDB is opened with external access off and its configuration locked: no reading files (`read_text('/etc/hosts')` fails), no writing files, no `ATTACH`, no extension `INSTALL` or `LOAD`, no network. Aftertrace checks that the statement is a single `SELECT` and runs it in a transaction that is rolled back. That matters most with `--listen 0.0.0.0`, where anyone who can reach the UI port can send SQL. Details: [api.md](api.md#raw-sql).

## Where the DB lives

Default file: `$HOME/.aftertrace/aftertrace.duckdb`. Override with `--db`. Alongside it DuckDB writes a write-ahead log, `*.duckdb.wal`.

After `./aftertrace serve --db ./data/aftertrace.duckdb`:

```
./data/aftertrace.duckdb
./data/aftertrace.duckdb.wal
```

One process at a time. A second `serve`, `demo`, or `import` on the same path fails with a conflicting lock.

## How to delete it

Stop `aftertrace`. Remove the DuckDB file and its WAL.

```bash
# default path
rm -f "$HOME/.aftertrace/aftertrace.duckdb" "$HOME/.aftertrace/aftertrace.duckdb.wal"
rmdir "$HOME/.aftertrace" 2>/dev/null || true

# if you used the quickstart path
rm -f ./data/aftertrace.duckdb ./data/aftertrace.duckdb.wal
```

That is the whole store. There is no remote copy.
