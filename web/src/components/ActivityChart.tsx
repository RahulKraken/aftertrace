import { useMemo, useState } from "react"
import { dur, usd } from "../lib/format"
import type { Session } from "../lib/types"

const DAY = 24 * 3600 * 1e3

export function dayKey(ns: number): string {
  const d = new Date(ns / 1e6)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

// Four weeks of agent time, a column a day: work in indigo, waiting on you in
// amber on top. Point at a day to read it; click it to show only that day.
// Visibility (Norman): the shape of your weeks, before any table.
export function ActivityChart({ sessions, day, onDay }: { sessions: Session[]; day: string | null; onDay: (k: string | null) => void }) {
  const [hover, setHover] = useState<number | null>(null)
  const days = useMemo(() => {
    if (!sessions.length) return []
    const last = new Date(Math.max(...sessions.map((s) => s.start_ns)) / 1e6)
    last.setHours(0, 0, 0, 0)
    const out = Array.from({ length: 28 }, (_, i) => {
      const d = new Date(last.getTime() - (27 - i) * DAY)
      return { date: d, key: `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`, work: 0, wait: 0, sessions: 0, cost: 0 }
    })
    const at = new Map(out.map((d) => [d.key, d]))
    for (const s of sessions) {
      const d = at.get(dayKey(s.start_ns))
      if (!d) continue
      const wait = s.breakdown?.permission_wait || 0
      d.wait += wait
      d.work += Math.max((s.turn_ms || 0) - wait, 0)
      d.sessions++
      d.cost += s.cost_usd || 0
    }
    return out
  }, [sessions])
  if (!days.length) return null
  const max = Math.max(...days.map((d) => d.work + d.wait), 1)
  const h = hover != null ? days[hover] : null
  return (
    <div className="activity" onMouseLeave={() => setHover(null)}>
      <div className="act-head">
        <span className="act-title">Last four weeks</span>
        <span className="act-read">
          {h ? (
            <>
              <b>{h.date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</b> ·{" "}
              {h.sessions ? `${h.sessions} ${h.sessions === 1 ? "session" : "sessions"} · ${dur(h.work + h.wait)} agent time${h.wait >= 1000 ? ` · ${dur(h.wait)} waiting on you` : ""} · ${usd(h.cost)}` : "nothing ran"}
            </>
          ) : day ? (
            <button type="button" className="act-clear" onClick={() => onDay(null)}>
              Showing one day · show all
            </button>
          ) : (
            <span className="mute">Point at a day; click to show only its sessions</span>
          )}
        </span>
      </div>
      <div className="act-cols">
        {days.map((d, i) => {
          const tot = d.work + d.wait
          return (
            <button
              type="button"
              key={d.key}
              className={`act-col${day === d.key ? " is-on" : ""}${day && day !== d.key ? " is-dim" : ""}${!tot ? " is-empty" : ""}`}
              style={{ ["--i" as string]: i }}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onClick={() => tot && onDay(day === d.key ? null : d.key)}
              aria-label={`${d.date.toDateString()}: ${dur(tot)}`}
            >
              <span className="act-bar" style={{ height: `${Math.max((tot / max) * 100, tot ? 4 : 2)}%` }}>
                {d.wait ? <i className="act-wait" style={{ height: `${(d.wait / tot) * 100}%` }} /> : null}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
