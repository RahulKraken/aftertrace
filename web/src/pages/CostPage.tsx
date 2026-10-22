import { useEffect, useState } from "react"
import { CACHE_TIP, EFFORT_TIP, Tip } from "../components/Tip"
import { ModelName, ToolName } from "../components/SpanIcon"
import { api } from "../lib/api"
import { dur, pct, tok, usd } from "../lib/format"
import type { CostTable } from "../lib/types"

// Column and dimension names as words, not field names.
const COL_LABEL: Record<string, string> = {
  cost_usd: "Cost",
  share: "Share",
  requests: "Requests",
  input: "Input",
  output: "Output",
  cache_read: "Cache read",
  cache_write: "Cache write",
  calls: "Calls",
  tokens: "Tokens",
  duration_ms: "Time",
}
const DIM_LABEL: Record<string, string> = {
  source: "Source",
  model: "Model",
  effort: "Effort",
  skill: "Skill",
  subagent: "Subagent",
  mcp: "Connector",
  tool: "Tool",
  repo: "Repo",
  query_source: "Query source",
}

const DIMS = ["source", "model", "effort", "skill", "subagent", "mcp", "tool", "repo", "query_source"] as const

function fmt(col: string, v: unknown): string {
  if (v == null) return "—"
  if (col === "cost_usd") return usd(Number(v))
  if (col === "share" || col === "cache_hit") return pct(Number(v))
  if (typeof v === "number") {
    if (col.endsWith("_s")) return dur(v * 1000)
    return tok(v)
  }
  return String(v)
}

function ShareCell({ v }: { v: unknown }) {
  const n = typeof v === "number" ? v : Number(v)
  if (!Number.isFinite(n)) return <>—</>
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
      <span
        style={{
          display: "inline-block",
          width: 52,
          height: 6,
          borderRadius: 99,
          background: "var(--bg-recessed)",
          overflow: "hidden",
        }}
      >
        <i
          className="grow-x"
          style={{
            display: "block",
            height: "100%",
            width: `${Math.max(2, Math.min(100, n * 100))}%`,
            background: "var(--hue-model)",
            borderRadius: 99,
          }}
        />
      </span>
      {pct(n)}
    </span>
  )
}

export function CostPage() {
  const [dim, setDim] = useState("model")
  const [d, setD] = useState<CostTable | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    api.cost(dim).then(setD).catch((e: Error) => setErr(e.message))
  }, [dim])

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <h1>Cost</h1>
      <div className="sub">{d?.note || "Cost is cost_usd from api_request events, joined to spans on request_id."}</div>
      <div className="seg" style={{ marginTop: 14 }}>
        {DIMS.map((x) => (
          <button type="button" key={x} className={x === dim ? "on" : undefined} onClick={() => setDim(x)}>
            {DIM_LABEL[x] || x}
          </button>
        ))}
      </div>
      {err && (
        <div className="empty">
          {err}
          <div className="err-next">Pick another dimension, or reload. Cost is read from api_request events.</div>
        </div>
      )}
      {d && (
        <table className="grid">
          <thead>
            <tr>
              {d.columns.map((c, i) => (
                <th key={c} className={i ? "r" : undefined}>
                  {c === "effort" ? (
                    <Tip label={EFFORT_TIP}>Effort</Tip>
                  ) : c === "cache_hit" ? (
                    <Tip label={CACHE_TIP}>Cache hit</Tip>
                  ) : (
                    COL_LABEL[c] || DIM_LABEL[c] || c
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="stagger">
            {d.rows.map((r, i) => (
              <tr key={i} style={{ cursor: "default" }}>
                {r.map((v, j) => (
                  <td key={j} className={j ? "num r" : undefined}>
                    {d.columns[j] === "share" ? (
                      <ShareCell v={v} />
                    ) : j === 0 && dim === "model" && typeof v === "string" ? (
                      <ModelName model={v} />
                    ) : j === 0 && dim === "tool" && typeof v === "string" ? (
                      <ToolName name={v} />
                    ) : (
                      fmt(d.columns[j], v)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
