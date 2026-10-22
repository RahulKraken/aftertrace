import { useMemo, useState } from "react"
import { X } from "lucide-react"
import { contentFor, snippet, type ContentIndex } from "../../lib/content"
import { ContentBlock } from "./ContentBlock"
import { CAT_LABEL, CATS, dur, pct, tok, usd } from "../../lib/format"
import { labelOf, rollup, runChild, spanKind, usageOf, waitChild, type SpanNode } from "../../lib/span"
import type { Finding, SpanKind, Trace } from "../../lib/types"
import { hueVar } from "../../lib/hue"
import { CACHE_TIP, EFFORT_TIP, Tip } from "../Tip"
import { glyphClass, SpanIcon } from "../SpanIcon"

export function DetailPane({
  node,
  trace,
  findings,
  content,
  onSelect,
  onClose,
}: {
  node: SpanNode
  trace: Trace
  findings: Finding[]
  content: ContentIndex
  onSelect: (id: string) => void
  onClose: () => void
}) {
  const k = spanKind(node)
  const { name, target } = labelOf(node)
  const a = node.attrs
  const j = node.joined || {}
  const cited = (node.findings || []).map((id) => findings.find((f) => f.id === id)).filter(Boolean) as Finding[]
  const parent = node.parent_span_id
  const related = trace.events.filter(
    (e) =>
      (a.tool_use_id && e.tool_use_id === a.tool_use_id) ||
      (a.request_id && e.request_id === a.request_id) ||
      (k === "turn" &&
        ["user_prompt", "compaction", "skill_activated", "subagent_completed", "hook_execution_complete", "api_retries_exhausted"].includes(
          e.name,
        )),
  )
  const io = contentFor(node, content)
  const hasIO = k === "turn" || k === "model" || k === "tool" || k === "agent"
  return (
    <aside className="pane accent" id="pane" style={{ ["--pane-hue" as string]: hueVar(node), flex: 1, width: "100%" }}>
      <h2>
        <span className={`glyph ${glyphClass(node)}`}>
          <SpanIcon span={node} />
        </span>
        <span className="pane-title">{name}</span>
        <span className="mono mute" style={{ fontWeight: 400 }}>
          {dur(node.duration_ms)}
        </span>
        <span className="spacer" />
        <button type="button" className="icon-btn pane-close" onClick={onClose} aria-label="Close panel" title="Close (Esc)">
          <X size={15} />
        </button>
      </h2>
      <div className="sub" style={{ marginTop: 4 }}>
        {target ? (
          <span className="pane-target" title={target}>
            {target}
          </span>
        ) : null}
        {parent ? (
          <>
            {" · "}
            <button type="button" className="add" onClick={() => onSelect(parent)} style={{ border: 0, background: "none", padding: 0 }}>
              parent
            </button>
          </>
        ) : null}
        {" · "}
        <span className="rid">{node.name}</span>
      </div>
      <Phases node={node} trace={trace} />
      <div className="sec">
        <div className="h">Metrics</div>
        <Metrics node={node} />
      </div>
      {hasIO && (
        <div className="sec">
          <ContentBlock
            key={`${node.span_id}:in`}
            label={io.inputLabel}
            content={io.input}
            note={io.inputNote || (content.any ? "not captured for this span" : undefined)}
          />
          <ContentBlock
            key={`${node.span_id}:out`}
            label={io.outputLabel}
            content={io.output}
            note={content.any ? "not captured for this span" : undefined}
          />
        </div>
      )}
      {k === "turn" && content.any && <Transcript root={node} content={content} onSelect={onSelect} />}
      {k === "turn" && trace.breakdown && <Mix bd={trace.breakdown} />}
      {cited.length > 0 && (
        <div className="sec">
          <div className="h">Findings citing this span</div>
          {cited.map((f) => (
            <div className="fnd" key={f.rule_id + f.headline}>
              <div>
                <span className={`pill ${f.severity}`}>{f.severity}</span> {f.headline}
              </div>
              <div className="mono mute" style={{ marginTop: 2 }}>
                {f.impact_unit.startsWith("USD") ? usd(f.impact_value) : dur(f.impact_value * 1000)} {f.impact_unit.replace(/^USD\s*/, "").replace(/^s\s*/, "")}
              </div>
              <div style={{ marginTop: 4, color: "var(--ink-2)" }}>{f.recommendation}</div>
            </div>
          ))}
        </div>
      )}
      {related.length > 0 && (
        <div className="sec">
          <div className="h">Joined events</div>
          {related.map((e, i) => (
            <details className="jev" key={`${e.name}:${e.ts_ns}:${i}`}>
              <summary className="mono">
                <span>{e.name}</span>
                <span className="mute">{e.tool_use_id ? "tool_use_id" : e.request_id ? "request_id" : "trace"}</span>
              </summary>
              <pre>{JSON.stringify(e.attrs, null, 2)}</pre>
            </details>
          ))}
        </div>
      )}
      <AttrTable key={node.span_id} attrs={a} kind={k} />
      <div className="sec">
        <details>
          <summary>Raw span</summary>
          <pre>{JSON.stringify({ ...node, kids: undefined }, null, 2)}</pre>
        </details>
      </div>
      {!content.any && (
        <div className="note" style={{ marginTop: 14 }}>
          Prompt, response and tool content are not captured. Set OTEL_LOG_USER_PROMPTS, OTEL_LOG_ASSISTANT_RESPONSES and
          OTEL_LOG_TOOL_CONTENT in Claude Code, and run aftertrace serve --store-content.
        </div>
      )}
      {k === "agent" && (
        <div className="note" style={{ marginTop: 8 }}>
          {rollup(node).n} spans in this subagent · {usd(rollup(node).cost)}
        </div>
      )}
      {j.query_source && k === "model" && <span hidden />}
    </aside>
  )
}

function AttrTable({ attrs, kind }: { attrs: Record<string, unknown>; kind: SpanKind }) {
  const [q, setQ] = useState("")
  const [showAll, setShowAll] = useState(false)
  const rows = useMemo(() => {
    const needle = q.toLowerCase()
    const filtered = Object.entries(attrs).filter(
      ([key, v]) => !needle || key.toLowerCase().includes(needle) || String(v).toLowerCase().includes(needle),
    )
    const ranked = rankAttrs(kind, filtered)
    if (needle || showAll || ranked.length <= 6) return { shown: ranked, hidden: 0, total: ranked.length }
    return { shown: ranked.slice(0, 6), hidden: ranked.length - 6, total: ranked.length }
  }, [attrs, q, kind, showAll])
  return (
    <div className="sec">
      <div className="h">Attributes</div>
      <input
        className="search"
        placeholder={`Filter ${Object.keys(attrs).length} attributes`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <table className="atable">
        <tbody>
          {rows.shown.map(([key, v]) => (
            <tr key={key}>
              <td>{key}</td>
              <td>
                {v === "<REDACTED>" || v === "[REDACTED]" ? (
                  <span className="content-hidden">content hidden</span>
                ) : typeof v === "object" ? (
                  JSON.stringify(v)
                ) : (
                  String(v)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.hidden > 0 && !q ? (
        <button type="button" className="show-all" onClick={() => setShowAll(true)}>
          show all {rows.total}
        </button>
      ) : null}
      {showAll && !q && Object.keys(attrs).length > 6 ? (
        <button type="button" className="show-all" onClick={() => setShowAll(false)}>
          show fewer
        </button>
      ) : null}
    </div>
  )
}

const ATTR_PRIORITY: Record<SpanKind, string[]> = {
  turn: ["interaction.sequence", "user_prompt_length", "interaction.duration_ms", "session.id", "vcs.repository.name", "app.version"],
  model: ["model", "effort", "input_tokens", "output_tokens", "cache_read_tokens", "request_id", "stop_reason", "attempt", "ttft_ms", "cache_creation_tokens"],
  tool: ["tool_name", "full_command", "file_path", "skill_name", "result_tokens", "bash_command_class", "tool_use_id", "agent_id", "bash_argv0"],
  agent: ["subagent_type", "tool_name", "agent_id", "parent_agent_id", "tool_use_id", "result_tokens"],
  wait: ["decision", "source", "duration_ms", "session.id", "span.type", "user.id"],
  run: ["success", "duration_ms", "error_class", "error", "tool_use_id", "gen_ai.tool.call.id"],
  hook: ["hook_name", "hook_event", "duration_ms", "session.id", "span.type"],
  span: ["span.type", "session.id", "duration_ms"],
}

function rankAttrs(kind: SpanKind, entries: [string, unknown][]): [string, unknown][] {
  const prio = ATTR_PRIORITY[kind] || ATTR_PRIORITY.span
  const map = new Map(entries)
  const out: [string, unknown][] = []
  const seen = new Set<string>()
  for (const key of prio) {
    if (map.has(key)) {
      out.push([key, map.get(key)])
      seen.add(key)
    }
  }
  for (const [key, v] of entries) {
    if (!seen.has(key)) out.push([key, v])
  }
  return out
}

function Mix({ bd }: { bd: NonNullable<Trace["breakdown"]> }) {
  const tot = CATS.reduce((a, c) => a + (bd[c] || 0), 0) || 1
  return (
    <div className="sec">
      <div className="h">Where time went</div>
      <div className="phase">
        {CATS.map((c) => (
          <i key={c} className={`c-${c}`} style={{ flex: bd[c] || 0 }} />
        ))}
      </div>
      {CATS.filter((c) => (bd[c] || 0) > 0).map((c) => (
        <div key={c} style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span>
            <i className={`c-${c}`} style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, marginRight: 6 }} />
            {CAT_LABEL[c]}
          </span>
          <span className="mono">
            {dur(bd[c] || 0)} · {pct((bd[c] || 0) / tot)}
          </span>
        </div>
      ))}
      <div className="note" style={{ marginTop: 6 }}>
        Wall clock painted by priority: waiting on you, retry waste, model, tool run, hooks. Overlaps count once.
      </div>
    </div>
  )
}

function Phases({ node, trace }: { node: SpanNode; trace: Trace }) {
  const k = spanKind(node)
  if (k === "model") {
    const rs = node.retry_end_ns ? (node.retry_end_ns - node.start_ns) / 1e6 : 0
    const tt = usageOf(node).ttftMs || 0
    const st = Math.max(0, node.duration_ms - rs - tt)
    return (
      <>
        <div className="phase">
          {rs > 0 && <i className="ph-retry" style={{ flex: rs }} />}
          <i className="ph-ttft" style={{ flex: tt || 1 }} />
          <i className="ph-solid" style={{ flex: st || 1 }} />
        </div>
        <div className="phasel">
          {rs > 0 && <span style={{ color: "var(--hue-retry)" }}>retries {dur(rs)}</span>}
          <span>ttft {dur(tt)}</span>
          <span>stream {dur(st)}</span>
        </div>
      </>
    )
  }
  if (k === "tool" || k === "agent") {
    const w = waitChild(node)
    const r = runChild(node)
    if (!w && !r) return null
    return (
      <>
        <div className="phase">
          {w && <i className="ph-wait" style={{ flex: w.duration_ms }} />}
          <i className={k === "agent" ? "ph-agent" : "ph-tool"} style={{ flex: r ? r.duration_ms : 1 }} />
        </div>
        <div className="phasel">
          {w && (
            <span style={{ color: "var(--hue-wait)" }}>
              blocked {dur(w.duration_ms)} · {String(w.attrs.source || "")}
            </span>
          )}
          <span>run {dur(r?.duration_ms)}</span>
        </div>
      </>
    )
  }
  if (k === "wait") {
    return (
      <>
        <div className="phase">
          <i className="ph-wait" style={{ flex: 1 }} />
        </div>
        <div className="phasel">
          <span style={{ color: "var(--hue-wait)" }}>blocked {dur(node.duration_ms)}</span>
        </div>
      </>
    )
  }
  if (k === "run") {
    return (
      <>
        <div className="phase">
          <i className="ph-tool" style={{ flex: 1 }} />
        </div>
        <div className="phasel">
          <span>run {dur(node.duration_ms)}</span>
        </div>
      </>
    )
  }
  if (k === "turn" && trace.breakdown) {
    return (
      <div className="phase" style={{ marginTop: 10 }}>
        {CATS.map((c) => (
          <i key={c} className={`c-${c}`} style={{ flex: trace.breakdown?.[c] || 0 }} />
        ))}
      </div>
    )
  }
  return null
}

function Metrics({ node }: { node: SpanNode }) {
  const k = spanKind(node)
  const a = node.attrs
  const j = node.joined || {}
  const pairs: [string, string][] = []
  const push = (key: string, v: unknown) => {
    if (v == null || v === "") return
    pairs.push([key, String(v)])
  }
  if (k === "model" && !node.name.startsWith("claude_code.")) {
    // OpenTelemetry GenAI: input_tokens already includes cache reads and writes.
    const u = usageOf(node)
    push("duration", dur(node.duration_ms))
    push(j.cost_estimated ? "cost (est.)" : "cost", usd(j.cost_usd))
    push("model", u.model)
    push("provider", j.provider)
    push("input", u.input != null ? tok(u.input) : "")
    push("output", u.output != null ? tok(u.output) : "")
    push("cache read", u.cacheRead != null ? tok(u.cacheRead) : "")
    push("cache write", u.cacheWrite != null ? tok(u.cacheWrite) : "")
    push("cache hit", u.input && u.cacheRead != null ? pct(u.cacheRead / u.input) : "")
    push("ttft", u.ttftMs != null ? dur(u.ttftMs) : "")
    push("error", a["error.type"])
  } else if (k === "model") {
    const tot = Number(a.input_tokens || 0) + Number(a.cache_read_tokens || 0) + Number(a.cache_creation_tokens || 0)
    push("duration", dur(node.duration_ms))
    push("cost", usd(j.cost_usd))
    push("model", a.model)
    push("effort", a.effort || "none")
    push("input", tok(Number(a.input_tokens)))
    push("output", tok(Number(a.output_tokens)))
    push("cache read", tok(Number(a.cache_read_tokens)))
    push("cache write", tok(Number(a.cache_creation_tokens)))
    push("cache hit", tot ? pct(Number(a.cache_read_tokens || 0) / tot) : "")
    push("attempt", a.attempt)
    push("skill", j["skill.name"])
    push("agent", j["agent.name"])
    push("mcp server", j["mcp_server.name"])
    push("stop reason", a.stop_reason)
    push("error", a.error_class)
  } else if (k === "tool" || k === "agent") {
    const w = waitChild(node)
    const r = runChild(node)
    const ro = rollup(node)
    push("duration", dur(node.duration_ms))
    if (k === "agent") {
      push("subagent", a.subagent_type)
      push("spans", ro.n)
      push("cost", usd(ro.cost))
    } else {
      push("result", a.result_tokens ? `${tok(Number(a.result_tokens))} tokens` : "")
      push("tool", a.tool_name)
      push("decision", w ? `${w.attrs.decision} (${w.attrs.source})` : "config")
      push("success", r ? String(r.attrs.success) : "")
      push("error", r?.attrs.error_class)
      push("bash class", a.bash_command_class)
      push("agent", a.agent_id)
    }
  } else if (k === "turn") {
    push("duration", dur(node.duration_ms))
    push("cost", usd(rollup(node).cost))
    push("prompt", a.user_prompt_length != null ? `${a.user_prompt_length} chars` : "")
    push("sequence", a["interaction.sequence"])
  } else {
    push("duration", dur(node.duration_ms))
    push("decision", a.decision)
    push("source", a.source)
    push("success", a.success != null ? String(a.success) : "")
    push("error", a.error_class)
  }
  return (
    <div className="mgrid">
      {pairs.map(([key, v]) => (
        <div key={key}>
          <div className="k">
            {key === "effort" ? (
              <Tip label={EFFORT_TIP}>effort</Tip>
            ) : key === "cache hit" || key === "cache read" || key === "cache write" ? (
              <Tip label={CACHE_TIP}>{key}</Tip>
            ) : (
              key
            )}
          </div>
          <div className="v">{v}</div>
        </div>
      ))}
    </div>
  )
}

// The turn as a conversation: prompt, then every model reply and tool call in
// start order, subagents included. Each line selects its span.
function Transcript({ root, content, onSelect }: { root: SpanNode; content: ContentIndex; onSelect: (id: string) => void }) {
  const items: { span: SpanNode; depth: number }[] = []
  const walk = (n: SpanNode, depth: number) => {
    for (const kid of [...n.kids].sort((x, y) => x.start_ns - y.start_ns)) {
      const kk = spanKind(kid)
      if (kk === "model" || kk === "tool" || kk === "agent") items.push({ span: kid, depth })
      if (kk === "agent" || kk === "turn") walk(kid, depth + 1)
    }
  }
  walk(root, 0)
  return (
    <div className="sec">
      <div className="h">Transcript</div>
      <div className="tx">
        {content.prompt && (
          <div className="tx-item tx-user">
            <div className="tx-who">You</div>
            <div className="tx-text">{content.prompt.text}</div>
          </div>
        )}
        {items.map(({ span, depth }) => {
          const kk = spanKind(span)
          const io = contentFor(span, content)
          if (kk === "model") {
            if (!io.output) return null
            return (
              <button type="button" key={span.span_id} className="tx-item tx-model" style={{ marginLeft: depth * 14 }} onClick={() => onSelect(span.span_id)}>
                <div className="tx-who">{labelOf(span).name}</div>
                <div className="tx-text">{io.output.text}</div>
              </button>
            )
          }
          const { name, target } = labelOf(span)
          return (
            <button type="button" key={span.span_id} className="tx-item tx-tool" style={{ marginLeft: depth * 14 }} onClick={() => onSelect(span.span_id)}>
              <div className="tx-who">
                {name} <span className="mute">{dur(span.duration_ms)}</span>
              </div>
              <div className="tx-text mono">{snippet(io.input, 400) || target}</div>
              {io.output && <div className="tx-out mono">{snippet(io.output, 300)}</div>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
