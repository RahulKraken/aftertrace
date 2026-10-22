import { useEffect, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { useLocation } from "wouter"
import { api } from "../lib/api"
import { dur, usd, when } from "../lib/format"
import type { Session } from "../lib/types"
import { EmptyState } from "../components/EmptyState"
import { MiniWaterfall } from "../components/MiniWaterfall"

type Filter = "all" | "running" | "findings" | "errors"

const FILTERS: { id: Filter; label: string; test: (s: Session) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "running", label: "Running", test: (s) => Boolean(s.running) },
  { id: "findings", label: "With findings", test: (s) => s.findings > 0 },
  { id: "errors", label: "With errors", test: (s) => s.errors > 0 },
]

function dayLabel(ns: number): string {
  const d = new Date(ns / 1e6)
  const today = new Date()
  const y = new Date()
  y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return "Today"
  if (d.toDateString() === y.toDateString()) return "Yesterday"
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })
}

export function SessionsPage() {
  const [rows, setRows] = useState<Session[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>("all")
  const [q, setQ] = useState("")
  const [, nav] = useLocation()

  useEffect(() => {
    api.sessions().then(setRows).catch((e: Error) => setErr(e.message))
  }, [])

  const running = Boolean(rows?.some((r) => r.running))
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => api.sessions().then(setRows).catch(() => {}), 5000)
    return () => window.clearInterval(t)
  }, [running])

  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter) || FILTERS[0]
    const needle = q.trim().toLowerCase()
    return (rows || []).filter(
      (s) =>
        f.test(s) &&
        (!needle ||
          [s.title, s.repo, s.session_id, ...(s.models || [])].some((v) => String(v || "").toLowerCase().includes(needle))),
    )
  }, [rows, filter, q])

  // Day dividers (Today, Yesterday, then dates), computed once per list.
  const groups = useMemo(() => {
    const out: { day: string; rows: Session[] }[] = []
    for (const s of shown) {
      const d = dayLabel(s.start_ns)
      if (!out.length || out[out.length - 1].day !== d) out.push({ day: d, rows: [] })
      out[out.length - 1].rows.push(s)
    }
    return out
  }, [shown])

  if (err) {
    return (
      <div className="page">
        {err}
        <div className="err-next">Reload this page. If it persists, check that aftertrace serve is running.</div>
      </div>
    )
  }
  if (!rows) return <div className="page mute">Loading sessions…</div>
  if (!rows.length) {
    return (
      <div className="page">
        <EmptyState />
      </div>
    )
  }

  return (
    <div className="page sessions">
      <h1>Sessions</h1>
      <div className="sub">Every Claude Code session, titled by the first thing you asked. Agent SDK runs show up here too.</div>
      <div className="list-tools">
        <div className="seg" role="tablist" aria-label="Filter sessions">
          {FILTERS.map((f) => {
            const n = rows.filter(f.test).length
            return (
              <button type="button" role="tab" aria-selected={filter === f.id} key={f.id} className={filter === f.id ? "on" : ""} onClick={() => setFilter(f.id)}>
                {f.label} <span className="seg-n">{n}</span>
              </button>
            )
          })}
        </div>
        <label className="list-search">
          <Search size={14} />
          <input placeholder="Search prompts, repos, models" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <table className="grid sessions-grid">
        <thead>
          <tr>
            <th>Session</th>
            <th>Started</th>
            <th className="r">Turns</th>
            <th className="r">Agent time</th>
            <th className="r">Waiting on you</th>
            <th className="r">Cost</th>
            <th className="r">Findings</th>
          </tr>
        </thead>
        <tbody>
          {groups.flatMap((g) => [
            <tr className="day-row" key={`d-${g.day}`}>
              <td colSpan={7}>{g.day}</td>
            </tr>,
            ...g.rows.map((s) => (
              <tr key={s.session_id} onClick={() => nav(`/session/${s.session_id}`)}>
                <td>
                  <span className="repo-shape">
                    <MiniWaterfall bd={s.breakdown} turns={s.turns} />
                    <span className="prompt-cell" title={s.title || undefined}>
                      {s.title || <span className="mono mute">{s.session_id.slice(0, 8)}</span>}
                    </span>
                    {s.repo && <span className="chip">{s.repo}</span>}
                    {s.running && <span className="run-pill">running</span>}
                  </span>
                </td>
                <td className="num mute">{when(s.start_ns).time}</td>
                <td className="num r">{s.turns}</td>
                <td className="num r">{dur(s.turn_ms)}</td>
                <td className="num r">{s.breakdown?.permission_wait ? dur(s.breakdown.permission_wait) : <span className="mute">—</span>}</td>
                <td className="num r">{usd(s.cost_usd)}</td>
                <td className="num r">{s.findings || <span className="mute">0</span>}</td>
              </tr>
            )),
          ])}
        </tbody>
      </table>
      {!shown.length && <div className="quiet-line">No sessions match.</div>}
    </div>
  )
}
