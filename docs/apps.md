# Apps and agents

Anything that is not Claude Code and sends OpenTelemetry to Aftertrace is an app: a service you built on the Claude SDK, a Pydantic AI agent on a cron, a script using the Vercel AI SDK. Aftertrace groups everything it receives by `service.name`, recognises model calls, and shows calls, cost, latency and failures per app and per operation.

## Connect an app

Open **Connect** in the UI; it builds the snippet with this server's real endpoints and confirms the first span. In short:

- **Claude SDK (TypeScript or Python):** register an OpenTelemetry tracer provider with an OTLP exporter pointed at `http://127.0.0.1:4318/v1/traces`. The SDK emits `anthropic.messages.create` spans with the GenAI conventions. Prompts and responses are included only with `ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE=content`.
- **Any OpenTelemetry library:** set `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` and `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`, then turn on the library's telemetry.
- **Claude Agent SDK:** it runs Claude Code underneath, so it sends Claude Code telemetry and shows up under Sessions, not Apps. Pass the variables through the options `env`.

Set `service.name`. It is the app's name everywhere in the UI.

## What counts as a model call

The [`calls`](writing-rules.md#tables-views-macros) view recognises, from current and deprecated conventions:

| Source | Spans |
| - | - |
| OpenTelemetry GenAI | `gen_ai.operation.name` of `chat`, `text_completion`, `generate_content`, `embeddings` |
| Claude SDK | `anthropic.messages.create` (the SDK's CLIENT span is skipped when the API's SERVER span for the same request is a child of it) |
| OpenInference | `openinference.span.kind = LLM` |
| Vercel AI SDK | `ai.generateText.doGenerate`, `ai.streamText.doStream`, `ai.generateObject.doGenerate`, `ai.streamObject.doStream` |
| OpenLLMetry | `llm.request.type` of `chat` or `completion` |
| Gemini CLI | `llm_call` |
| Hand-rolled | any span with `gen_ai.request.model` and `gen_ai.usage.*_tokens` |

Agent, workflow and tool spans (`invoke_agent`, `execute_tool`, ...) are not calls. Their usage is the sum of the calls inside them, so an agent span's aggregated usage is never counted twice.

An app's **operation** is the AI SDK `ai.telemetry.functionId` when there is one, otherwise the name of the trace's root span: `POST /api/chat`, `job.summarize`, `invoke_agent digest`. Give your root spans names that mean something.

## Cost

If the span reports a cost (`llm.cost.total` in OpenInference, `operation.cost` in Pydantic AI), Aftertrace uses it. Otherwise it estimates cost from tokens with the price table in [`internal/pricing`](../internal/pricing/pricing.go): Anthropic, OpenAI and Gemini models, USD per million tokens, matched by the longest model-id prefix after stripping `vendor/` and `us.anthropic.`-style prefixes. Estimated costs are marked "est." in the UI.

The estimate ignores batch discounts, regional surcharges and long-context pricing. A model missing from the table has no cost; add it to the table in a PR.

## Findings for apps

`app.model_downgrade`, `app.errors` and `app.no_prompt_cache` run on the `calls` view. See [findings.md](findings.md).

## Content

Message content from apps (`gen_ai.input.messages`, `gen_ai.output.messages`, tool arguments and results, and each library's equivalents) is dropped at ingest unless `aftertrace serve --store-content`. The full key list is in [privacy.md](privacy.md).
