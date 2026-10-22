# Redaction

Private data has to pass two gates before anything is written. The first is in Claude Code, which decides what it sends. The second is in Aftertrace, which deletes identity always and content unless you ask to keep it.

<!-- figure:redaction -->
![Fig 3, Redaction: a coin sorter for attributes. A box on the left stands for Claude Code, with valves on its lid for its OTEL_LOG switches. It pours tokens, one per attribute key, onto a deck on springs. Small red identity tokens always fall through the first slot into a drawer. Indigo content tokens fall through the second slot into another drawer unless a shutter covers it. Teal tool details and grey everything-else ride to the end and drop into the store.](../images/figure-redaction.png)

Press **P** for the prompt valve, **T** for the tool details valve, **C** for the content shutter, or click them. The readout follows one key at a time.

## Gate 1: what Claude Code sends

Claude Code keeps prompt text, responses and tool content to itself unless you switch them on. The switches are environment variables, all off by default:

| Switch | What it adds | Aftertrace's advice |
|---|---|---|
| `OTEL_LOG_TOOL_DETAILS=1` | Bash commands (`full_command`), file paths, skill, agent, plugin and MCP names, `tool_parameters` | Turn on. Several findings need real names. |
| `OTEL_LOG_USER_PROMPTS=1` | The prompt text you typed (`user_prompt`, `prompt`, `prompt_text`) | Leave off. |
| `OTEL_LOG_ASSISTANT_RESPONSES=1` | Response text in events | Leave off. |
| `OTEL_LOG_TOOL_CONTENT=1` | `tool.output` span events: file text, command output, fetch results | Leave off. |
| `OTEL_LOG_RAW_API_BODIES=1` | Every request and response body, the whole conversation | Never for Aftertrace. |

With prompts off, Claude Code still sends the `user_prompt` key, with the value `<REDACTED>`, and a `user_prompt_length` that is just a number. The figure shows that as a dim indigo token. Details and caveats per switch: [Connect Claude Code](../claude-code-setup.md#opting-into-content).

## Gate 2: what Aftertrace deletes

Every OTLP batch is decoded, then converted to rows, then written. Redaction runs in the middle step, in `internal/otlp/convert.go`, on each attribute map before it becomes a row:

- the resource attributes of every batch (traces, logs and metrics),
- every span's attributes,
- every span event's attributes,
- every log record's attributes,
- every metric data point's attributes.

That is seven calls to `redact.Attrs` in all. Each call deletes keys by exact name, plus any key that starts with a content prefix:

- **6 identity keys, always:** `user.email`, `user.account_uuid`, `user.account_id`, `user.id`, `organization.id`, `process.owner`. `--store-content` does not bring them back.
- **41 content keys and 4 prefixes, unless `--store-content`:** Claude Code's `user_prompt`, `prompt`, `prompt_text`, `response`, `response.model_output`, `tool_input`, `tool.output`, `output`, `new_context` and `body`, plus the GenAI, OpenLLMetry, OpenInference, Vercel AI SDK, Pydantic AI and Gemini CLI names. The prefixes are `gen_ai.prompt.`, `gen_ai.completion.`, `llm.input_messages.` and `llm.output_messages.`. The full list is in [Privacy](../privacy.md#what-is-redacted-by-default).

Every other key is kept. That includes `session.id`, model names, token counts, costs, durations, and the tool details from gate 1. Tool details are not content keys, so when Claude Code sends them, Aftertrace stores them.

A log record's body is never stored. Aftertrace only reads it to name the event when the record has no `event.name` attribute.

The same gate runs for `aftertrace import`. `aftertrace demo` loads its synthetic sessions with content kept, because nothing in them is real.

## Before and after

A `claude_code.llm_request` span as Claude Code sends it, and as it is stored. Values are made up.

```
sent                                        stored
session.id         "4f1c9e…"                session.id         "4f1c9e…"
user.email         "you@example.com"        ·
user.account_uuid  "8a2e51…"                ·
organization.id    "c71b02…"                ·
terminal.type      "vscode"                 terminal.type      "vscode"
model              "claude-opus-5-5"        model              "claude-opus-5-5"
input_tokens       1840                     input_tokens       1840
output_tokens      412                      output_tokens      412
cache_read_tokens  52010                    cache_read_tokens  52010
ttft_ms            1430                     ttft_ms            1430
request_id         "req_01…"                request_id         "req_01…"
```

The `api_request` event for the same call. Only identity goes.

```
sent                                        stored
event.name         "api_request"            event.name         "api_request"
session.id         "4f1c9e…"                session.id         "4f1c9e…"
user.email         "you@example.com"        ·
organization.id    "c71b02…"                ·
model              "claude-opus-5-5"        model              "claude-opus-5-5"
cost_usd           0.0412                   cost_usd           0.0412
duration_ms        6120                     duration_ms        6120
request_id         "req_01…"                request_id         "req_01…"
```

The `claude_code.interaction` span that opened the turn, with `OTEL_LOG_USER_PROMPTS=1` and without `--store-content`. Claude Code sent the text, and Aftertrace deleted it.

```
sent                                        stored
user_prompt        "fix the flaky test…"    ·
user_prompt_length 31                       user_prompt_length 31
```

## The four settings

| Claude Code switch | `--store-content` | Prompt text in the store | Identity in the store |
|---|---|---|---|
| off (default) | off (default) | no: it was never sent | no |
| off | on | no: it was never sent; `user_prompt` is kept as `<REDACTED>` | no |
| `OTEL_LOG_USER_PROMPTS=1` | off | no: Aftertrace deletes it | no |
| `OTEL_LOG_USER_PROMPTS=1` | on | **yes** | no |

The same holds for every other key in the content list, such as `tool.output` with `OTEL_LOG_TOOL_CONTENT=1`. `OTEL_LOG_TOOL_DETAILS=1` is different: commands and paths are stored whatever `--store-content` says, because they are not content keys. A command line can hold a secret, so leave that switch off if yours do.

## Checking it

The serve log prints the gate when it starts:

```
redact=on store_content=false  (no telemetry)
```

To confirm nothing private got in, ask the store. The raw SQL box on the Query page runs this:

```sql
SELECT
  count(*) FILTER (WHERE json_extract_string(attrs, '$."user.email"') IS NOT NULL) AS emails,
  count(*) FILTER (WHERE json_extract_string(attrs, '$.user_prompt') <> '<REDACTED>') AS prompt_texts
FROM spans
```

`emails` is always 0. `prompt_texts` is 0 unless you switched prompts on in Claude Code and also ran with `--store-content`.

## Next

- [Receiving](receive.md): how batches arrive, before this step.
- [The store](store.md): where the rows that survive are written.
- [Privacy](../privacy.md): every key, the SQL sandbox, and how to delete the file.
