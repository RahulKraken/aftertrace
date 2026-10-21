import { useEffect, useState, type CSSProperties } from "react"
import { useLocation } from "wouter"
import { api } from "../lib/api"
import { dur, usd, when } from "../lib/format"
import { weekStory } from "../lib/story"
import type { Session } from "../lib/types"
import { EmptyState } from "../components/EmptyState"
import { MiniWaterfall } from "../components/MiniWaterfall"

export function SessionsPage() {
  const [rows, setRows] = useState<Session[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [, nav] = useLocation()

  useEffect(() => {
    api.sessions().then(setRows).catch((e: Error) => setErr(e.message))
  }, [])

  if (err) {
    return (
      <div className="page">
        {err}
        <div className="err-next">Reload this page. If it persists, check that the mock fixtures loaded.</div>
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
    <div className="page">
      <WeekLine />
      <table className="grid">
        <thead>
          <tr>
            <th>Started</th>
            <th>Repo</th>
            <th className="r">Time</th>
            <th className="r">Cost</th>
            <th className="r">Findings</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const t = when(s.start_ns)
            return (
              <tr key={s.session_id} onClick={() => nav(`/session/${s.session_id}`)}>
                <td className="num">
                  <span className="date">{t.date}</span>
                  {t.time}
                </td>
                <td>
                  <span className="repo-shape">
                    <MiniWaterfall bd={s.breakdown} turns={s.turns} />
                    {s.repo || ""}
                  </span>
                </td>
                <td className="num r">{dur(s.turn_ms)}</td>
                <td className="num r">{usd(s.cost_usd)}</td>
                <td className="num r">{s.findings || <span className="mute">0</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function WeekLine() {
  const { waitPct, savedMin } = weekStory()
  return (
    <h1 className="story-line week-line">
      You spent{" "}
      <span className="week-pct" style={{ "--pct": waitPct } as CSSProperties}>
        {waitPct}%
        <i className="week-pct-mark" aria-hidden="true" />
      </span>{" "}
      of this week waiting on approvals, and saved {savedMin} min.
    </h1>
  )
}
