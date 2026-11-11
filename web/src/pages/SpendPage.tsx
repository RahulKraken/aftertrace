import { useEffect, useState } from "react"
import { api, emptyMode } from "../lib/api"
import { EmptyState } from "../components/EmptyState"
import { Ribbon } from "../components/Ribbon"
import { SearchField, Segmented, Toolbar } from "../lib/chrome"
import { useShell } from "../components/Shell"
import { dur, pct, tok, usd } from "../lib/format"
import { fromBreakdown } from "../lib/ribbon"
import { receiptMarkdown } from "../lib/receipt"
import { readPlan } from "../lib/plan"
import { useToast } from "../lib/toast"
import type { CostTable, Recap } from "../lib/types"
import { useLocation } from "wouter"

type Range = "week" | "month" | "all"

const DIMS = [
  { id: "model", label: "Model" },
  { id: "repo", label: "Repo" },
  { id: "skill", label: "Skill" },
  { id: "tool", label: "Tool" },
  { id: "mcp", label: "MCP" },
  { id: "source", label: "Source" },
  { id: "effort", label: "Effort" },
] as const

export function SpendPage() {
  const { openCommand } = useShell()
  const [, nav] = useLocation()
  const toast = useToast()
  const [range, setRange] = useState<Range>("week")
  const [dim, setDim] = useState("model")
  const [table, setTable] = useState<CostTable | null>(null)
  const [recap, setRecap] = useState<Recap | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    api.cost(dim).then(setTable).catch((e: Error) => setErr(e.message))
    api.recap(0).then(setRecap).catch(() => undefined)
  }, [dim])

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e" && recap) {
        e.preventDefault()
        exportMd(recap, toast)
      }
    }
    window.addEventListener("keydown", on)
    return () => window.removeEventListener("keydown", on)
  }, [recap, toast])

  if (err && !table) {
    return (
      <>
        <Toolbar title="Spend" />
        <EmptyState line="Aftertrace can't reach its engine. Restart it?" action="Reload" onClick={() => window.location.reload()} />
      </>
    )
  }
  if (emptyMode()) {
    return (
      <>
        <Toolbar title="Spend">
          <SearchField onClick={openCommand} />
        </Toolbar>
        <EmptyState line="Spend shows up after your first session." action="Turn on live tracing" href="/settings?tab=sources" />
      </>
    )
  }

  const stats = recap?.stats
  const prev = recap?.prev
  const delta = stats && prev ? stats.cost_usd - prev.cost_usd : 0
  const parts = stats ? fromBreakdown(stats.breakdown) : null
  const costIdx = table?.columns.indexOf("cost_usd") ?? -1
  const shareIdx = table?.columns.indexOf("share") ?? -1
  const reqIdx = table?.columns.findIndex((c) => c === "requests" || c === "calls") ?? -1
  const inIdx = table?.columns.indexOf("input") ?? -1
  const outIdx = table?.columns.indexOf("output") ?? -1
  const hitIdx = table?.columns.indexOf("cache_hit") ?? -1
  const labelIdx = 0
  const maxShare = Math.max(...(table?.rows || []).map((r) => Number(r[shareIdx] || 0)), 0.01)

  return (
    <>
      <Toolbar title="Spend" sub={stats ? usd(stats.cost_usd) : ""}>
        <Segmented
          ariaLabel="Range"
          value={range}
          options={[
            { id: "week", label: "Week" },
            { id: "month", label: "Month" },
            { id: "all", label: "All" },
          ]}
          onChange={setRange}
        />
        <select className="select" value={dim} onChange={(e) => setDim(e.target.value)} aria-label="Dimension">
          {DIMS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn" onClick={() => nav("/query")}>
          Ask
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => recap && exportMd(recap, toast)}
          title="Export (⌘E)"
        >
          Export
        </button>
        <SearchField onClick={openCommand} />
      </Toolbar>
      <div className="body">
        <div className="pad">
          {stats && (
            <>
              <div className="hero" style={{ gridTemplateColumns: "auto auto 1fr" }}>
                <div>
                  <div className="big n">{usd(stats.cost_usd)}</div>
                  <div className="cap">
                    {delta === 0 ? "same as last week" : `${delta > 0 ? "+" : ""}${usd(delta)} vs last week`}
                  </div>
                </div>
                <div>
                  <div className="big n">{dur(stats.turn_ms)}</div>
                  <div className="cap">agent time</div>
                </div>
                <div className="facts">
                  <div>
                    <b className="n">{stats.sessions}</b> sessions
                  </div>
                  <div>
                    <b className="n">{tok(stats.tokens)}</b> tokens
                  </div>
                  <div>
                    <b className="n">{pct(stats.cache_hit)}</b> cache hit
                  </div>
                </div>
              </div>
              {parts ? <Ribbon parts={parts} tall /> : null}
            </>
          )}
          <div className="tblwrap" style={{ marginTop: 22 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>{DIMS.find((d) => d.id === dim)?.label || "Name"}</th>
                  <th className="r">Cost</th>
                  <th>Share</th>
                  <th className="r">Requests</th>
                  <th className="r">Tokens in</th>
                  <th className="r">Tokens out</th>
                  <th className="r">Cache hit</th>
                </tr>
              </thead>
              <tbody>
                {(table?.rows || []).map((r, i) => (
                  <tr key={i}>
                    <td>{String(r[labelIdx] ?? "—")}</td>
                    <td className="r">{costIdx >= 0 ? usd(Number(r[costIdx] || 0)) : "—"}</td>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, width: "100%" }}>
                        <span style={{ flex: 1, maxWidth: 88 }}>
                          <i
                            className="t-think"
                            style={{
                              display: "block",
                              height: 6,
                              borderRadius: 3,
                              width: `${Math.max(4, (Number(r[shareIdx] || 0) / maxShare) * 100)}%`,
                            }}
                          />
                        </span>
                        {shareIdx >= 0 ? pct(Number(r[shareIdx])) : ""}
                      </span>
                    </td>
                    <td className="r">{reqIdx >= 0 ? String(r[reqIdx] ?? "—") : "—"}</td>
                    <td className="r">{inIdx >= 0 ? tok(Number(r[inIdx] || 0)) : "—"}</td>
                    <td className="r">{outIdx >= 0 ? tok(Number(r[outIdx] || 0)) : "—"}</td>
                    <td className="r">{hitIdx >= 0 ? pct(Number(r[hitIdx])) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {table?.estimated ? <p className="l2 small">Estimated from session files.</p> : null}
          </div>
        </div>
      </div>
    </>
  )
}

function exportMd(recap: Recap, toast: (t: string) => void) {
  const md = receiptMarkdown(recap, readPlan(), false)
  navigator.clipboard.writeText(md).then(() => toast("Copied markdown")).catch(() => toast("Could not copy"))
}
