import { useEffect, useMemo, useState } from "react"
import { ArrowRight, Check, SquareTerminal } from "lucide-react"
import { siAnthropic, siClaude, siGooglegemini, siOpentelemetry } from "simple-icons"
import { BrandIcon } from "../components/BrandIcon"
import { Logo } from "../components/Logo"
import { Num } from "../components/Num"
import { Link, useLocation } from "wouter"
import { useStatus } from "../lib/status"
import { useNow } from "../hooks/useNow"
import { CopyButton } from "../components/CopyButton"
import { api } from "../lib/api"
import { ago, int, sayTok, sayUsd } from "../lib/format"
import { actionSentence, moneyLabel } from "../lib/welcome"
import type { Finding, Source, Status } from "../lib/types"

type Variant = { label: string; lang: string; code: (ep: Endpoints) => string; note?: string }
type SourceDef = {
  id: string
  name: string
  blurb: string
  badge?: string
  // Which received service.name counts as "connected" for this source.
  matches: (s: Source) => boolean
  where: string
  variants: Variant[]
  prompt?: (ep: Endpoints, content: boolean) => string
  after: string
}
type Endpoints = { grpc: string; http: string }

const DOCS = "https://github.com/RahulKraken/aftertrace/blob/main/docs"

const CC_ENV = (ep: Endpoints, content: boolean) => {
  const env: Record<string, string> = {
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
    CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
    OTEL_METRICS_EXPORTER: "otlp",
    OTEL_LOGS_EXPORTER: "otlp",
    OTEL_TRACES_EXPORTER: "otlp",
    OTEL_EXPORTER_OTLP_PROTOCOL: "grpc",
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://${ep.grpc}`,
    OTEL_LOG_TOOL_DETAILS: "1",
  }
  if (content) {
    env.OTEL_LOG_USER_PROMPTS = "1"
    env.OTEL_LOG_ASSISTANT_RESPONSES = "1"
    env.OTEL_LOG_TOOL_CONTENT = "1"
  }
  return env
}

// Each source wears its own mark, so you can find yours without reading.
// OpenAI's mark is not in open icon sets, so Codex gets a terminal.
const SOURCE_ICONS: Record<string, React.ReactNode> = {
  "claude-code": <BrandIcon icon={siClaude} size={15} />,
  "agent-sdk": <BrandIcon icon={siClaude} size={15} />,
  "claude-sdk": <BrandIcon icon={siAnthropic} size={15} />,
  otel: <BrandIcon icon={siOpentelemetry} size={15} />,
  codex: <SquareTerminal size={15} strokeWidth={1.75} />,
  gemini: <BrandIcon icon={siGooglegemini} size={15} />,
}

const SOURCES: SourceDef[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    blurb: "The CLI, the desktop app and IDE extensions. Sessions, turns, every tool call, cost and time.",
    badge: "Recommended",
    matches: (s) => s.kind === "claude-code",
    where: "~/.claude/settings.json",
    variants: [
      {
        label: "settings.json",
        lang: "json",
        code: () => "",
        note: "Use your user settings file. Claude Code ignores these keys in a repository's .claude/settings.json. Merge them into any env block you already have.",
      },
    ],
    prompt: (ep, content) =>
      `Merge these keys into the "env" object in ~/.claude/settings.json. Keep every existing key and setting, and make a backup first:\n\n${JSON.stringify(
        CC_ENV(ep, content),
        null,
        2,
      )}\n\nThen tell me to restart Claude Code.`,
    after: "Restart Claude Code and send a prompt.",
  },
  {
    id: "agent-sdk",
    name: "Claude Agent SDK",
    blurb: "Agents you build on the Agent SDK. Same telemetry as Claude Code: pass the variables through the options env.",
    matches: (s) => s.kind === "claude-code",
    where: "your agent's code",
    variants: [
      {
        label: "Python",
        lang: "python",
        code: (ep) => `from claude_agent_sdk import ClaudeAgentOptions, query

options = ClaudeAgentOptions(
    env={  # merged with the inherited environment
${Object.entries(CC_ENV(ep, false))
  .map(([k, v]) => `        "${k}": "${v}",`)
  .join("\n")}
        "OTEL_SERVICE_NAME": "my-agent",
    },
)`,
      },
      {
        label: "TypeScript",
        lang: "ts",
        code: (ep) => `import { query } from "@anthropic-ai/claude-agent-sdk"

const options = {
  // options.env replaces the environment, so spread process.env first.
  env: {
    ...process.env,
${Object.entries(CC_ENV(ep, false))
  .map(([k, v]) => `    ${k}: "${v}",`)
  .join("\n")}
    OTEL_SERVICE_NAME: "my-agent",
  },
}`,
      },
    ],
    after: "Run the agent once.",
  },
  {
    id: "claude-sdk",
    name: "App on the Claude SDK",
    blurb: "Your own app calling the Claude API. The SDK emits OpenTelemetry spans when a tracer provider is registered.",
    matches: (s) => s.kind === "app",
    where: "your app's startup code",
    variants: [
      {
        label: "TypeScript",
        lang: "ts",
        code: (ep) => `// npm i @opentelemetry/sdk-trace-node @opentelemetry/sdk-trace-base \\
//       @opentelemetry/exporter-trace-otlp-proto @opentelemetry/resources
import Anthropic from "@anthropic-ai/sdk"
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node"
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto"
import { resourceFromAttributes } from "@opentelemetry/resources"

const provider = new NodeTracerProvider({
  resource: resourceFromAttributes({ "service.name": "my-app" }),
  spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: "http://${ep.http}/v1/traces" }))],
})
provider.register()

const client = new Anthropic() // uses the registered tracer provider`,
      },
      {
        label: "Python",
        lang: "python",
        code: (ep) => `# pip install opentelemetry-sdk opentelemetry-exporter-otlp-proto-http
import anthropic
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

provider = TracerProvider(resource=Resource.create({"service.name": "my-app"}))
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint="http://${ep.http}/v1/traces")))
trace.set_tracer_provider(provider)

client = anthropic.Anthropic()  # uses the global tracer provider`,
        note: "Spans carry metadata only. Set ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE=content to include prompts and responses.",
      },
    ],
    after: "Make one request from your app.",
  },
  {
    id: "otel",
    name: "Any OpenTelemetry GenAI app",
    blurb: "Vercel AI SDK, Pydantic AI, OpenLLMetry, OpenInference, or your own spans with gen_ai.* attributes.",
    matches: (s) => s.kind === "app",
    where: "the app's environment",
    variants: [
      {
        label: "Environment",
        lang: "sh",
        code: (ep) => `export OTEL_SERVICE_NAME=my-app
export OTEL_EXPORTER_OTLP_ENDPOINT=http://${ep.http}
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`,
        note: "Then turn on your library's telemetry: experimental_telemetry: { isEnabled: true } in the Vercel AI SDK, logfire.instrument_pydantic_ai() in Pydantic AI, Traceloop.init() in OpenLLMetry.",
      },
    ],
    after: "Make one model call from your app.",
  },
  {
    id: "codex",
    name: "OpenAI Codex CLI",
    blurb: "Codex sends events and metrics over OTLP. Stored and queryable now; dedicated views are coming.",
    badge: "Preview",
    matches: (s) => /codex/i.test(s.name),
    where: "~/.codex/config.toml",
    variants: [
      {
        label: "config.toml",
        lang: "toml",
        code: (ep) => `[otel]
exporter = { otlp-grpc = { endpoint = "http://${ep.grpc}" } }
log_user_prompt = false`,
      },
    ],
    after: "Start a Codex session.",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    blurb: "Gemini CLI sends spans, logs and metrics. Stored and queryable now; dedicated views are coming.",
    badge: "Preview",
    matches: (s) => /gemini/i.test(s.name),
    where: "~/.gemini/settings.json",
    variants: [
      {
        label: "settings.json",
        lang: "json",
        code: (ep) => `{
  "telemetry": {
    "enabled": true,
    "otlpEndpoint": "http://${ep.grpc}",
    "otlpProtocol": "grpc",
    "logPrompts": false
  }
}`,
        note: "Gemini CLI logs prompt text by default; logPrompts: false turns that off.",
      },
    ],
    after: "Start a Gemini CLI session.",
  },
]

function welcomeQuery(): "found" | "empty" | null {
  if (typeof window === "undefined") return null
  const hash = window.location.hash || ""
  if (hash.startsWith("#/empty")) return "empty"
  const q = hash.split("?")[1] || window.location.search.replace(/^\?/, "")
  const w = new URLSearchParams(q).get("welcome")
  if (w === "found" || w === "empty") return w
  return null
}

function connectMode(status: Status | null): "found" | "empty" | "full" {
  const forced = welcomeQuery()
  if (forced) return forced
  if (status?.live_otel) return "full"
  if (typeof window !== "undefined" && localStorage.getItem("aftertrace.welcome") === "done") return "full"
  if (status?.history?.found) return "found"
  if (status && !status.history?.found) return "empty"
  return "full"
}

const WELCOME_KEY = "aftertrace.welcome"

export function ConnectPage() {
  const status = useStatus()
  const mode = connectMode(status)
  if (mode === "found") return <FoundHistory status={status} />
  if (mode === "empty") return <EmptyHistory status={status} />
  return <ConnectSources />
}

function spanLabel(first?: number, last?: number): string {
  if (!first) return ""
  const a = new Date(first / 1e6)
  const b = new Date((last || first) / 1e6)
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }
  const as = a.toLocaleDateString("en-GB", opts)
  const bs = b.toLocaleDateString("en-GB", opts)
  return as === bs ? as : `${as} – ${bs}`
}

function sessionsHref(f: Finding): string {
  const ids = (f.sessions || []).filter(Boolean)
  if (ids.length === 1) return `/session/${ids[0]}`
  if (ids.length > 1) return `/sessions?ids=${ids.join(",")}`
  return "/sessions"
}

function FoundHistory({ status }: { status: Status | null }) {
  const [, nav] = useLocation()
  const h = status?.history
  if (!h?.found) return <EmptyHistory status={status} />
  const done = () => localStorage.setItem(WELCOME_KEY, "done")
  const maxDay = Math.max(1, ...h.series.map((d) => d.sessions))
  const f = status?.welcome_finding ?? null
  const span = f ? spanLabel(f.first_ns, f.last_ns) : ""
  const action = f ? actionSentence(f) : ""
  const save = f ? moneyLabel(f, span) : ""
  return (
    <div className="page connect-first">
      <div className="found">
        <div className="found-mark">
          <Logo size={22} />
        </div>
        <p className="found-kicker">
          Found {h.days} {h.days === 1 ? "day" : "days"} of Claude Code sessions
        </p>
        <p className="found-spend">
          <Num value={h.cost_usd} format={(n) => sayUsd(n, true)} />
          <span className="found-dot">·</span>
          <Num value={h.tokens} format={sayTok} /> tokens
          <span className="found-dot">·</span>
          <Num value={h.sessions} format={(n) => int(Math.round(n))} /> {h.sessions === 1 ? "session" : "sessions"}
        </p>
        {h.series.length > 1 && (
          <div className="found-days" aria-hidden="true">
            {h.series.map((d) => (
              <i key={d.day} style={{ height: `${Math.max((d.sessions / maxDay) * 100, d.sessions ? 8 : 2)}%` }} />
            ))}
          </div>
        )}

        {f ? (
          <div className="found-one">
            <h1>{action}</h1>
            {save ? <p className="found-save">{save}</p> : null}
            <p className="found-meta">
              {[f.project, span].filter(Boolean).join(" · ")}
            </p>
            {f.estimated ? <p className="found-est">estimated from session files</p> : null}
            <button
              type="button"
              className="btn found-cta"
              onClick={() => {
                done()
                nav(sessionsHref(f))
              }}
            >
              Show me <ArrowRight size={14} />
            </button>
          </div>
        ) : (
          <div className="found-one">
            <h1>Nothing worth changing in last month&apos;s history</h1>
            <button
              type="button"
              className="btn found-cta"
              onClick={() => {
                done()
                nav("/")
              }}
            >
              See your usage <ArrowRight size={14} />
            </button>
          </div>
        )}

        <p className="found-foot">
          <Link
            href="/findings"
            className="found-all"
            onClick={done}
          >
            See all findings
          </Link>
          <span className="found-nudge">Connecting live tracing also catches slow hooks and retry waste.</span>
        </p>
      </div>
    </div>
  )
}

function EmptyHistory({ status }: { status: Status | null }) {
  const dir = status?.history?.dir || status?.info.history_dir || "~/.claude/projects"
  return (
    <div className="page connect-first">
      <div className="found is-empty">
        <div className="found-mark">
          <Logo size={22} />
        </div>
        <h1>No Claude Code sessions on this machine</h1>
        <p className="found-lede">
          Aftertrace looked in <code>{dir}</code>. Nothing was there, so the next step is the live export — then your first turn shows up here.
        </p>
        <ClaudeCodeSnippet status={status} />
      </div>
    </div>
  )
}

function ClaudeCodeSnippet({ status }: { status: Status | null }) {
  const [content, setContent] = useState(false)
  const ep: Endpoints = {
    grpc: status?.info.otlp_grpc || "127.0.0.1:4317",
    http: status?.info.otlp_http || "127.0.0.1:4318",
  }
  const code = JSON.stringify({ env: CC_ENV(ep, content) }, null, 2)
  const src = SOURCES[0]
  return (
    <div className="found-otel">
      <div className="code">
        <div className="code-bar">
          <span className="mute">{src.where}</span>
          <CopyButton text={code} label="Copy" className="btn ghost btn-sm" />
          {src.prompt && <CopyButton text={src.prompt(ep, content)} label="Copy as a prompt for Claude Code" done="Prompt copied" className="btn ghost btn-sm" />}
        </div>
        <pre>{code}</pre>
      </div>
      <label className="opt">
        <input type="checkbox" checked={content} onChange={(e) => setContent(e.target.checked)} />
        <span>
          Also capture prompts, responses and tool output. Off by default; it needs <code>aftertrace serve --store-content</code> too.
        </span>
      </label>
      <div className="note">Restart Claude Code after saving. Merge these keys into any env block you already have.</div>
    </div>
  )
}

function ConnectSources() {
  const status = useStatus()
  const [pick, setPick] = useState(SOURCES[0].id)
  const [variant, setVariant] = useState(0)
  const [content, setContent] = useState(false)
  const src = SOURCES.find((s) => s.id === pick) || SOURCES[0]
  const ep: Endpoints = useMemo(
    () => ({ grpc: status?.info.otlp_grpc || "127.0.0.1:4317", http: status?.info.otlp_http || "127.0.0.1:4318" }),
    [status],
  )
  const v = src.variants[Math.min(variant, src.variants.length - 1)]
  const code = src.id === "claude-code" ? JSON.stringify({ env: CC_ENV(ep, content) }, null, 2) : v.code(ep)

  return (
    <div className="page connect">
      <h1>Connect a source</h1>
      <div className="sub">Everything stays on this machine. Pick what you want to see, paste one snippet, and this page confirms the first data.</div>

      <div className="connect-grid">
        <div className="src-list" role="tablist" aria-label="Sources">
          {SOURCES.map((s) => (
            <button
              type="button"
              role="tab"
              aria-selected={s.id === pick}
              key={s.id}
              className={`src-item${s.id === pick ? " on" : ""}`}
              onClick={() => {
                setPick(s.id)
                setVariant(0)
              }}
            >
              <span className="src-name">
                <span className="src-logo">{SOURCE_ICONS[s.id]}</span>
                {s.name}
                {s.badge && <span className={`src-badge${s.badge === "Preview" ? " is-preview" : ""}`}>{s.badge}</span>}
              </span>
              <span className="src-blurb">{s.blurb}</span>
            </button>
          ))}
          <a href={`${DOCS}/behind-a-collector.md`} target="_blank" rel="noreferrer" className="src-item src-more">
            <span className="src-name">
              <span className="src-logo">
                <BrandIcon icon={siOpentelemetry} size={15} />
              </span>
              Behind a collector, or on another machine
            </span>
            <span className="src-blurb">Fan out from an existing OpenTelemetry Collector, or import its file-exporter JSONL with aftertrace import.</span>
          </a>
        </div>

        <div className="steps">
          <Step n={1} title="Aftertrace is listening" done>
            <div className="mono listen">
              OTLP gRPC {ep.grpc} · OTLP HTTP {ep.http}
            </div>
            {status && !status.info.service && (
              <div className="note">
                This server stops when you log out or restart. To start it at login, stop it and run{" "}
                <code>aftertrace service install{status.info.store_content ? " --store-content" : ""}</code>.{" "}
                <a href={`${DOCS}/cli.md#aftertrace-service`} target="_blank" rel="noreferrer">
                  How it works
                </a>
              </div>
            )}
          </Step>

          <Step n={2} title={`Add this to ${src.where}`}>
            {src.variants.length > 1 && (
              <div className="seg seg-sm" role="tablist">
                {src.variants.map((x, i) => (
                  <button type="button" key={x.label} className={i === variant ? "on" : ""} onClick={() => setVariant(i)}>
                    {x.label}
                  </button>
                ))}
              </div>
            )}
            <div className="code">
              <div className="code-bar">
                <span className="mute">{v.label}</span>
                <CopyButton text={code} label="Copy" className="btn ghost btn-sm" />
                {src.prompt && (
                  <CopyButton text={src.prompt(ep, content)} label="Copy as a prompt for Claude Code" done="Prompt copied" className="btn ghost btn-sm" />
                )}
              </div>
              <pre>{code}</pre>
            </div>
            {v.note && <div className="note">{v.note}</div>}
            {src.id === "claude-code" && (
              <label className="opt">
                <input type="checkbox" checked={content} onChange={(e) => setContent(e.target.checked)} />
                <span>
                  Also capture prompts, responses and tool output. Off by default; it needs <code>aftertrace serve --store-content</code> too.
                  {status && (
                    <span className={status.info.store_content ? " ok-text" : " mute"}>
                      {" "}
                      This server {status.info.store_content ? "keeps content." : "drops content."}
                    </span>
                  )}
                </span>
              </label>
            )}
          </Step>

          <Step n={3} title={src.after}>
            <Verify src={src} />
          </Step>
        </div>
      </div>
    </div>
  )
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className={`step${done ? " is-done" : ""}`}>
      <div className="step-n">{done ? <Check size={13} /> : n}</div>
      <div className="step-body">
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  )
}

// Live verification on the same page (Norman: feedback). Anything from a
// matching source that arrives after the page opened counts.
function Verify({ src }: { src: SourceDef }) {
  const [opened] = useState(() => Date.now() * 1e6)
  const [sources, setSources] = useState<Source[] | null>(null)
  const now = useNow(1000)
  useEffect(() => {
    let alive = true
    const load = () =>
      api
        .sources()
        .then((r) => alive && setSources(r.sources))
        .catch(() => undefined)
    load()
    const t = window.setInterval(load, 2000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [])
  const match = (sources || []).filter(src.matches)
  const fresh = match.find((s) => s.last_ns > opened)
  const earlier = match[0]
  if (fresh) {
    return (
      // The moment it works is worth marking: the check lands with a ring, once.
      <div className="verify is-ok is-celebrate" role="status">
        <span className="verify-check">
          <Check size={15} strokeWidth={2.75} />
        </span>
        <span>
          Receiving from <b>{fresh.name}</b>, {ago(fresh.last_ns, now)}. <Num value={fresh.spans} format={(n) => int(Math.round(n))} /> spans,{" "}
          <Num value={fresh.events} format={(n) => int(Math.round(n))} /> events so far.
        </span>
        <Link href={fresh.kind === "app" ? "/apps" : "/"} className="sec-link">
          Open it <ArrowRight size={13} />
        </Link>
      </div>
    )
  }
  return (
    <div className="verify" role="status">
      <i className="verify-dot" />
      <span>
        Listening for the first data…
        {earlier && (
          <span className="mute">
            {" "}
            (last from <span className="mono">{earlier.name}</span> {ago(earlier.last_ns, now)})
          </span>
        )}
      </span>
    </div>
  )
}
