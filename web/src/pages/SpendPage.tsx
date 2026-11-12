import { useEffect, useMemo, useState } from "react"
import { Link, useLocation } from "wouter"
import { api, emptyMode, isTransientError } from "../lib/api"
import { EmptyState } from "../components/EmptyState"
import { SearchField, Segmented, Toolbar } from "../lib/chrome"
import { useShell } from "../components/Shell"
import { durHead, modelName, pct, tok, usd } from "../lib/format"
import { receiptMarkdown } from "../lib/receipt"
import { recapLead, recapShipped } from "../lib/recapStory"
import { spendLead } from "../lib/spendInsight"
import { readPlan } from "../lib/plan"
import { useToast } from "../lib/toast"
import { modelFamily } from "../lib/model"
import type { CostTable, ModelSpend, Overview, Recap, Session } from "../lib/types"

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

const MODEL_TINT: Record<string, string> = {
  opus: "var(--l1)",
  sonnet: "var(--c-think)",
  haiku: "var(--c-tool)",
  other: "var(--c-other)",
}

export function SpendPage() {
  const { openCommand } = useShell()
  const [, nav] = useLocation()
  const toast = useToast()
  const [range, setRange] = useState<Range>("week")
  const [dim, setDim] = useState("model")
  const [table, setTable] = useState<CostTable | null>(null)
  const [recap, setRecap] = useState<Recap | null>(null)
  const [ov, setOv] = useState<Overview | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    api.cost(dim).then((t) => { setTable(t); setErr(null) }).catch((e: Error) => {
      if (!isTransientError(e) && !table && !ov) setErr("Aftertrace can't reach its engine.")
    })
    api.recap(0).then(setRecap).catch(() => undefined)
    api.overview().then(setOv).catch(() => undefined)
    api.sessions().then(setSessions).catch(() => undefined)
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

  const week = ov?.week
  const weekSessions = useMemo(() => {
    if (!ov) return sessions
    return sessions.filter((s) => s.start_ns >= ov.lo && s.start_ns < ov.hi)
  }, [sessions, ov])
  const byModel = useMemo(() => modelSpend(ov), [ov])
  const modelTotal = byModel.reduce((a, m) => a + m.cost_usd, 0) || week?.cost_usd || 1
  const top = useMemo(
    () => [...weekSessions].sort((a, b) => (b.cost_usd || 0) - (a.cost_usd || 0)).slice(0, 5),
    [weekSessions],
  )
  const prev = recap?.prev
  const delta = week && prev ? week.cost_usd - prev.cost_usd : 0
  const costIdx = table?.columns.indexOf("cost_usd") ?? -1
  const shareIdx = table?.columns.indexOf("share") ?? -1
  const reqIdx = table?.columns.findIndex((c) => c === "requests" || c === "calls") ?? -1
  const inIdx = table?.columns.indexOf("input") ?? -1
  const outIdx = table?.columns.indexOf("output") ?? -1
  const hitIdx = table?.columns.indexOf("cache_hit") ?? -1
  const labelIdx = 0
  const weekCost = week?.cost_usd || 0
  const insightLead = spendLead(weekSessions, weekCost) || (recap ? recapLead(recap).map((p) => p.text).join("") : "")
  const insightShipped = recap ? recapShipped(recap).map((p) => p.text).join("") : ""

  if (err && !table && !ov) {
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

  return (
    <>
      <Toolbar title="Spend" sub={week ? usd(week.cost_usd) : ""}>
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
          Ask about spend
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
        <div className="pad spend">
          {insightLead || insightShipped ? (
            <p className="insight">{[insightLead, insightShipped].filter(Boolean).join(" ")}</p>
          ) : null}
          {week && (
            <div className="hero">
              <div>
                <div className="big n">{usd(week.cost_usd)}</div>
                <div className="cap">
                  {delta === 0 ? "same as last week" : `${delta > 0 ? "+" : ""}${usd(delta)} vs last week`}
                </div>
              </div>
              <div>
                <div className="big n">{durHead(week.turn_ms)}</div>
                <div className="cap">agent time</div>
              </div>
              <div className="facts">
                <div>
                  <b className="n">{week.sessions}</b> sessions
                </div>
                <div>
                  <b className="n">{tok(week.tokens)}</b> tokens
                </div>
                <div>
                  <b className="n">{pct(week.cache_hit)}</b> cache hit
                </div>
              </div>
            </div>
          )}
          {byModel.length > 0 && (
            <>
              <div className="model-bar" aria-label="Spend by model">
                {byModel.map((m) => (
                  <i
                    key={m.model}
                    style={{
                      flex: Math.max(m.cost_usd, 0.01),
                      background: MODEL_TINT[modelFamily(m.model)],
                    }}
                    title={`${modelName(m.model) || m.model}: ${usd(m.cost_usd)}`}
                  />
                ))}
              </div>
              <div className="key">
                {byModel.map((m) => (
                  <span key={m.model}>
                    <i style={{ background: MODEL_TINT[modelFamily(m.model)] }} />
                    {modelName(m.model) || m.model} <b className="n">{usd(m.cost_usd)}</b>
                    <span className="l3"> {pct(m.cost_usd / modelTotal)}</span>
                  </span>
                ))}
              </div>
            </>
          )}
          <div className="spend-grid">
            <div>
              <div className="sec-h">By {DIMS.find((d) => d.id === dim)?.label.toLowerCase()}</div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>{DIMS.find((d) => d.id === dim)?.label || "Name"}</th>
                    <th className="r">Cost</th>
                    <th className="r">Share</th>
                    <th className="r">Requests</th>
                  </tr>
                </thead>
                <tbody>
                  {(table?.rows || []).map((r, i) => {
                    const cost = costIdx >= 0 ? Number(r[costIdx] || 0) : 0
                    const share = weekCost > 0 ? cost / weekCost : Number(r[shareIdx] || 0)
                    return (
                      <tr key={i}>
                        <td>{String(r[labelIdx] ?? "—")}</td>
                        <td className="r">{usd(cost)}</td>
                        <td className="r">{pct(share)}</td>
                        <td className="r">{reqIdx >= 0 ? String(r[reqIdx] ?? "—") : inIdx >= 0 ? tok(Number(r[inIdx] || 0)) : "—"}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {table?.estimated ? <p className="l2 small">Estimated from session files.</p> : null}
              {hitIdx >= 0 || outIdx >= 0 ? (
                <p className="l3 small">
                  {(table?.rows || [])
                    .slice(0, 3)
                    .map((r) => `${r[labelIdx]} ${hitIdx >= 0 ? pct(Number(r[hitIdx])) + " cache" : ""}`.trim())
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
            </div>
            <div>
              <div className="sec-h">Top sessions by cost</div>
              <div className="list">
                {top.map((s) => (
                  <Link key={s.session_id} href={`/session/${s.session_id}`} className="li">
                    <div className="t">
                      <div>{s.title || "Untitled session"}</div>
                      <div className="l2 small">{s.repo || "—"}</div>
                    </div>
                    <span className="v n">{usd(s.cost_usd)}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function modelSpend(ov: Overview | null): ModelSpend[] {
  if (!ov) return []
  const map = new Map<string, ModelSpend>()
  for (const d of ov.days.slice(-7)) {
    for (const m of d.by_model || []) {
      const hit = map.get(m.model) || { model: m.model, cost_usd: 0, tokens: 0 }
      hit.cost_usd += m.cost_usd
      hit.tokens = (hit.tokens || 0) + (m.tokens || 0)
      map.set(m.model, hit)
    }
  }
  return [...map.values()].filter((m) => m.cost_usd > 0).sort((a, b) => b.cost_usd - a.cost_usd)
}

function exportMd(recap: Recap, toast: (t: string) => void) {
  const md = receiptMarkdown(recap, readPlan(), false)
  navigator.clipboard.writeText(md).then(() => toast("Copied markdown")).catch(() => toast("Could not copy"))
}
