import { useEffect, useMemo, useState } from "react"
import { useLocation } from "wouter"
import { api } from "../lib/api"
import { usd } from "../lib/format"
import { useHashQuery } from "../lib/hash"
import type { Session } from "../lib/types"
import { EmptyState } from "../components/EmptyState"
import { Trace, turnsFromSession } from "../components/Trace"
import { AppsPage } from "./AppsPage"

const DAY = 86400e9
const START_MIN = 8 * 60
const SPAN_MIN = 14 * 60
const HOURS = [8, 10, 12, 14, 16, 18, 20, 22]

function dayKey(ns: number): string {
  const d = new Date(ns / 1e6)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function dayLabel(ns: number, today: Date): string {
  const d = new Date(ns / 1e6)
  const same = d.toDateString() === today.toDateString()
  const wd = d.toLocaleDateString("en-GB", { weekday: "short" })
  const n = d.getDate()
  const mon = d.toLocaleDateString("en-GB", { month: "short" })
  if (same) return `${wd} ${n} ${mon}`
  return `${wd} ${n}`
}

export function SessionsPage() {
  const [rows, setRows] = useState<Session[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const q = useHashQuery()
  const src = q.get("src")
  const [filter, setFilter] = useState<"all" | "claude" | "apps">(src === "apps" ? "apps" : "all")
  const [, nav] = useLocation()
  const [tip, setTip] = useState<{ s: Session; x: number; y: number } | null>(null)

  useEffect(() => {
    if (src === "apps") setFilter("apps")
    else if (filter === "apps") setFilter("all")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  useEffect(() => {
    api.sessions().then(setRows).catch((e: Error) => setErr(e.message))
  }, [])

  const running = Boolean(rows?.some((r) => r.running))
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => api.sessions().then(setRows).catch(() => {}), 5000)
    return () => window.clearInterval(t)
  }, [running])

  const week = useMemo(() => {
    const list = rows || []
    if (!list.length) return []
    const hi = Math.max(...list.map((s) => s.end_ns || s.start_ns))
    const lo = hi - 7 * DAY
    return list.filter((s) => s.start_ns >= lo)
  }, [rows])

  const maxTurn = useMemo(() => {
    let m = 0.01
    for (const s of week) {
      const ts = turnsFromSession(s.session_id, s.turns, s.cost_usd || 0)
      for (const t of ts) if (t > m) m = t
    }
    return m
  }, [week])

  const groups = useMemo(() => {
    const today = new Date()
    const days: { key: string; label: string; ns: number; rows: Session[]; total: number }[] = []
    const sorted = [...week].sort((a, b) => b.start_ns - a.start_ns)
    for (const s of sorted) {
      const k = dayKey(s.start_ns)
      let g = days.find((d) => d.key === k)
      if (!g) {
        g = { key: k, label: dayLabel(s.start_ns, today), ns: s.start_ns, rows: [], total: 0 }
        days.push(g)
      }
      g.rows.push(s)
      g.total += s.cost_usd || 0
    }
    return days
  }, [week])

  const shown = filter === "claude" ? week.filter((s) => !isApp(s)) : week
  const shownGroups = groups
    .map((g) => ({ ...g, rows: filter === "claude" ? g.rows.filter((s) => !isApp(s)) : g.rows }))
    .map((g) => ({ ...g, total: g.rows.reduce((a, s) => a + (s.cost_usd || 0), 0) }))
    .filter((g) => g.rows.length)

  if (err) return <div className="v2">{err}</div>
  if (!rows) return <div className="v2 mute">…</div>
  if (!rows.length) {
    return (
      <div className="v2">
        <EmptyState />
      </div>
    )
  }

  const totMs = shown.reduce((a, s) => a + s.turn_ms, 0)
  const totUsd = shown.reduce((a, s) => a + (s.cost_usd || 0), 0)
  const h = Math.floor(totMs / 3_600_000)
  const min = Math.round((totMs % 3_600_000) / 60_000)

  const setSeg = (id: "all" | "claude" | "apps") => {
    setFilter(id)
    nav(id === "apps" ? "/sessions?src=apps" : "/sessions")
  }

  return (
    <div className="v2 sess-v2">
      <h1 className="sr-only">Sessions</h1>
      <section className="hd">
        <div className="stats">
          {filter !== "apps" ? (
            <>
              <div>
                <span className="big">{shown.length}</span>
                <span className="u">sessions</span>
              </div>
              <div className="md">
                {h}
                <small>h</small>
                {min}
                <small>min</small>
              </div>
              <div className="md">{usd(totUsd)}</div>
            </>
          ) : null}
        </div>
        <div className="seg" role="tablist" aria-label="Filter sessions">
          <button type="button" role="tab" aria-selected={filter === "all"} className={filter === "all" ? "on" : ""} onClick={() => setSeg("all")}>
            All
          </button>
          <button type="button" role="tab" aria-selected={filter === "claude"} className={filter === "claude" ? "on" : ""} onClick={() => setSeg("claude")}>
            Claude Code
          </button>
          <button type="button" role="tab" aria-selected={filter === "apps"} className={filter === "apps" ? "on side-item" : "side-item"} onClick={() => setSeg("apps")}>
            Apps
          </button>
        </div>
      </section>

      {filter === "apps" ? (
        <div className="sess-apps">
          <AppsPage />
        </div>
      ) : (
        <section className="tl">
          <div className="axis" data-nc>
            {HOURS.map((hr) => (
              <span key={hr} style={{ left: `${((hr * 60 - START_MIN) / SPAN_MIN) * 100}%` }}>
                {String(hr).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {shownGroups.map((g) => (
            <div className="srow" key={g.key}>
              <div className="d" data-nc>
                {g.label}
              </div>
              <div className="lane">
                {g.rows.map((s) => {
                  const start = new Date(s.start_ns / 1e6)
                  const mins = start.getHours() * 60 + start.getMinutes()
                  const durMin = Math.max(4, (s.turn_ms || 1) / 60_000)
                  const left = Math.max(0, Math.min(96, ((mins - START_MIN) / SPAN_MIN) * 100))
                  const width = Math.max(1.4, Math.min(28, (durMin / SPAN_MIN) * 100))
                  const turns = turnsFromSession(s.session_id, s.turns, s.cost_usd || 0)
                  const wpx = Math.max(16, Math.round((width / 100) * 1000))
                  return (
                    <div
                      key={s.session_id}
                      className="s"
                      style={{ left: `${left}%`, width: `${width}%` }}
                      onClick={() => nav(`/session/${s.session_id}`)}
                      onMouseEnter={(e) => {
                        const box = (e.currentTarget.closest(".tl") as HTMLElement)?.getBoundingClientRect()
                        const r = e.currentTarget.getBoundingClientRect()
                        setTip({ s, x: r.left - (box?.left || 0) + r.width / 2 - 40, y: r.top - (box?.top || 0) + 56 })
                      }}
                      onMouseLeave={() => setTip(null)}
                    >
                      <Trace
                        turns={turns}
                        width={wpx}
                        height={52}
                        max={maxTurn}
                        flag={s.findings > 0}
                        live={Boolean(s.running)}
                        sw={1.4}
                        r={3}
                      />
                    </div>
                  )
                })}
              </div>
              <div className="tot n">{usd(g.total)}</div>
            </div>
          ))}
          {tip ? (
            <div className="tip" style={{ left: tip.x, top: tip.y }}>
              <div className="t">{tip.s.title || tip.s.repo || tip.s.session_id.slice(0, 8)}</div>
              <div className="a">{usd(tip.s.cost_usd)}</div>
              <div className="m">
                {fmtDur(tip.s.turn_ms)} · {tip.s.turns} turns
              </div>
            </div>
          ) : null}
        </section>
      )}
    </div>
  )
}

function isApp(s: Session): boolean {
  const e = (s.entrypoint || "").toLowerCase()
  return Boolean(e) && !e.includes("cli") && !e.includes("claude") && !e.includes("vscode")
}

function fmtDur(ms: number): string {
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}
