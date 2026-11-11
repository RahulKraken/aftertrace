import { useEffect, useState } from "react"
import { CaretRight } from "@phosphor-icons/react"
import { Link, useLocation, useParams } from "wouter"
import { api } from "../lib/api"
import { startPoll } from "../lib/poll"
import { dur, modelName, usd, when } from "../lib/format"
import type { SessionDetail } from "../lib/types"
import { Ribbon } from "../components/Ribbon"
import { fromBreakdown } from "../lib/ribbon"
import { Toolbar } from "../lib/chrome"
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
    return startPoll(async () => {
      try {
        setD(await api.session(id))
      } catch {
        /* keep last */
      }
    }, { visibleMs: 5000, hiddenMs: 30000 })
  }, [running, params.id])

  if (err) {
    return (
      <>
        <Toolbar title="Session" />
        <div className="page">
          {err}
          <div className="err-next">Go back to Sessions and pick another id, or check that the mock fixtures loaded.</div>
        </div>
      </>
    )
  }
  if (!d) {
    return (
      <>
        <Toolbar title="Session" />
        <div className="page mute">Loading session…</div>
      </>
    )
  }
  const s = d.session
  const maxMs = Math.max(...d.turns.map((t) => t.duration_ms || 0), 1)

  return (
    <>
      <Toolbar>
        <div className="crumb">
          <Link href="/sessions">Sessions</Link>
          <CaretRight />
          <b>{s.title || "Untitled session"}</b>
        </div>
      </Toolbar>
      <div className="body">
        <div className="pad">
          <h1 className="session-title tl">{s.title || "Untitled session"}</h1>
          <p className="session-story l2">{sessionStory(s)}</p>
          <div className="tstats">
            {s.repo ? <span>{s.repo}</span> : null}
            {s.models[0] ? <span>{modelName(s.models[0])}</span> : null}
            <span>
              {s.turns} {s.turns === 1 ? "turn" : "turns"}
            </span>
            <span>
              <b className="n">{dur(s.turn_ms)}</b>
            </span>
            <span>
              <b className="n">{usd(s.cost_usd)}</b>
            </span>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Turn</th>
                <th>Prompt</th>
                <th>Where time went</th>
                <th className="r">Started</th>
                <th className="r">Duration</th>
                <th className="r">Cost</th>
              </tr>
            </thead>
            <tbody>
              {d.turns.map((t, i) => {
                const w = when(t.start_ns)
                return (
                  <tr key={t.trace_id} onClick={() => nav(`/trace/${t.trace_id}`)}>
                    <td className="n">{t.seq || i + 1}</td>
                    <td className="c-title">
                      <div className="title">{t.prompt || "—"}</div>
                      {t.running ? <div className="doing">running</div> : t.in_progress ? <div className="doing">incomplete</div> : null}
                    </td>
                    <td>
                      <Ribbon parts={fromBreakdown(t.breakdown)} length={(t.duration_ms || 0) / maxMs} />
                    </td>
                    <td className="r l2 n">
                      {w.date} {w.time}
                    </td>
                    <td className="r n">{dur(t.duration_ms)}</td>
                    <td className="r n">{usd(t.cost_usd)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
