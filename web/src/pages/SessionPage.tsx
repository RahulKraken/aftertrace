import { useEffect, useState } from "react"
import { Link, useLocation, useParams } from "wouter"
import { api } from "../lib/api"
import { dur, usd, when } from "../lib/format"
import type { SessionDetail } from "../lib/types"
import { MiniWaterfall } from "../components/MiniWaterfall"
import { sessionStory } from "../lib/story"

export function SessionPage() {
  const params = useParams<{ id: string }>()
  const [, nav] = useLocation()
  const [d, setD] = useState<SessionDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!params.id) return
    api.session(params.id).then(setD).catch((e: Error) => setErr(e.message))
  }, [params.id])

  const running = Boolean(d?.turns.some((t) => t.running))
  useEffect(() => {
    if (!running || !params.id) return
    const id = params.id
    const t = window.setInterval(() => api.session(id).then(setD).catch(() => {}), 5000)
    return () => window.clearInterval(t)
  }, [running, params.id])

  if (err) {
    return (
      <div className="page">
        {err}
        <div className="err-next">Go back to Sessions and pick another id, or check that the mock fixtures loaded.</div>
      </div>
    )
  }
  if (!d) return <div className="page mute">Loading session…</div>
  const s = d.session

  return (
    <div className="page">
      <div className="crumbs">
        <Link href="/sessions">Sessions</Link> › <span className="mono">{s.session_id.slice(0, 8)}</span>
      </div>
      <h1 className="story-line week-line">{sessionStory(s)}</h1>
      <table className="grid">
        <thead>
          <tr>
            <th>Turn</th>
            <th>Prompt</th>
            <th>Started</th>
            <th className="r">Duration</th>
            <th className="r">Cost</th>
          </tr>
        </thead>
        <tbody>
          {d.turns.map((t, i) => {
            const w = when(t.start_ns)
            return (
              <tr key={t.trace_id} onClick={() => nav(`/trace/${t.trace_id}`)}>
                <td className="num">
                  <span className="repo-shape">
                    <MiniWaterfall bd={t.breakdown} turns={1} />
                    {t.seq || i + 1}
                    {t.running ? <span className="run-pill">running</span> : t.in_progress ? <span className="run-pill is-stale">incomplete</span> : null}
                  </span>
                </td>
                <td className="prompt-cell">{t.prompt ? <span title={t.prompt}>{t.prompt}</span> : <span className="mute">—</span>}</td>
                <td className="num">
                  <span className="date">{w.date}</span>
                  {w.time}
                </td>
                <td className="num r">{dur(t.duration_ms)}</td>
                <td className="num r">{usd(t.cost_usd)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
