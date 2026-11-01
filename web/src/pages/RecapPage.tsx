import { useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { api } from "../lib/api"
import { usd } from "../lib/format"
import { weekLabel } from "../lib/receipt"
import type { Recap, Session } from "../lib/types"
import { DailyBars } from "../components/v2/Charts"
import { turnsFromSession } from "../components/Trace"

export function RecapPage() {
  const [week, setWeek] = useState(0)
  const [r, setR] = useState<Recap | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .recap(week)
      .then((x) => alive && setR(x))
      .catch((e: Error) => alive && setErr(e.message))
    return () => {
      alive = false
    }
  }, [week])

  useEffect(() => {
    api.sessions().then(setSessions).catch(() => undefined)
  }, [])

  const days = useMemo(() => {
    if (!r) return { cur: [0, 0, 0, 0, 0, 0, 0], prev: [0, 0, 0, 0, 0, 0, 0] }
    const span = r.hi - r.lo
    const prevLo = r.lo - span
    const cur = Array(7).fill(0) as number[]
    const prev = Array(7).fill(0) as number[]
    const bucket = (ns: number, lo: number) => Math.max(0, Math.min(6, Math.floor((ns - lo) / (span / 7))))
    for (const s of sessions) {
      if (s.start_ns >= r.lo && s.start_ns < r.hi) cur[bucket(s.start_ns, r.lo)] += s.cost_usd || 0
      else if (s.start_ns >= prevLo && s.start_ns < r.lo) prev[bucket(s.start_ns, prevLo)] += s.cost_usd || 0
    }
    return { cur, prev }
  }, [r, sessions])

  if (err && !r) return <div className="v2">{err}</div>
  if (!r) return <div className="v2 mute">…</div>

  const s = r.stats
  const delta = s.cost_usd - (r.prev.cost_usd || 0)
  const calmer = delta < -0.05
  const busier = delta > 0.05
  const headline = !s.turns ? "A quiet week" : calmer ? "A calmer week" : busier ? "A busier week" : "A steady week"
  const inWeek = sessions.filter((x) => x.start_ns >= r.lo && x.start_ns < r.hi)
  const loudest = [...inWeek].sort((a, b) => (b.cost_usd || 0) - (a.cost_usd || 0))[0]
  const loudTurns = loudest ? turnsFromSession(loudest.session_id, loudest.turns, loudest.cost_usd || 0) : []
  const peak = loudTurns.reduce((a, n, i) => (n > (loudTurns[a] || 0) ? i : a), 0)
  const cache = s.cache_hit
  const cachePrev = r.prev.cache_hit

  return (
    <div className="v2 recap-v2">
      <h1 className="hl recap-story">{headline}</h1>
      <section className="r1">
        <div className="rcard tot">
          <div className="lbl" data-nc>
            {weekLabel(r)}
          </div>
          <div className="big">{usd(s.cost_usd)}</div>
          {r.prev.cost_usd > 0 ? <div className="was">{usd(r.prev.cost_usd)}</div> : null}
          {Math.abs(delta) >= 0.05 ? (
            <div className="delta" style={{ color: delta < 0 ? "var(--good)" : "var(--ink-2)" }}>
              {delta < 0 ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 5v14M6 13l6 6 6-6" />
                </svg>
              ) : null}
              ${Math.abs(delta).toFixed(2)}
            </div>
          ) : null}
          <div className="wk-nav recap-nav">
            <button type="button" className="iconbtn" disabled={!r.has_older} onClick={() => setWeek(week + 1)} aria-label="Previous week" title="Previous week">
              <ChevronLeft size={15} />
            </button>
            <button type="button" className="iconbtn" disabled={week === 0} onClick={() => setWeek(week - 1)} aria-label="Next week" title="Next week">
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
        <div className="rcard">
          <div className="leg">
            <span>
              <i style={{ background: "var(--ink)" }} />
              This week
            </span>
            <span>
              <i style={{ background: "var(--rule-2)" }} />
              Last week
            </span>
          </div>
          <DailyBars cur={days.cur} prev={days.prev} />
        </div>
      </section>
      <section className="r2">
        {loudest ? (
          <div className="rcard">
            <div className="lbl">Loudest</div>
            <svg width="100%" height="120" viewBox="0 0 860 120" style={{ marginTop: 14 }}>
              <LoudPath turns={loudTurns} peak={peak} />
            </svg>
            <div className="ttl2">
              <span className="t">{loudest.title || loudest.repo || "Session"}</span>
              <span className="a">{usd(loudest.cost_usd)}</span>
            </div>
          </div>
        ) : (
          <div className="rcard">
            <div className="lbl">Loudest</div>
          </div>
        )}
        {cache != null ? (
          <div className="rcard kv">
            <div className="lbl">Cache</div>
            <div className="v">{Math.round(cache * 100)}%</div>
            {cachePrev != null && Math.abs(cachePrev - cache) >= 0.005 ? <div className="s">{Math.round(cachePrev * 100)}%</div> : null}
          </div>
        ) : null}
      </section>
    </div>
  )
}

function LoudPath({ turns, peak }: { turns: number[]; peak: number }) {
  const n = Math.max(turns.length, 2)
  const max = Math.max(...turns, 0.01)
  const pts = turns.map((v, i) => {
    const x = 2 + (i / Math.max(n - 1, 1)) * 848
    const y = 16 + (1 - v / max) * 88
    return { x, y, v }
  })
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ")
  const pk = pts[peak] || pts[pts.length - 1]
  const last = pts[pts.length - 1]
  return (
    <>
      <path d={d} fill="none" stroke="var(--ink)" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      {pk ? (
        <>
          <circle cx={pk.x} cy={pk.y} r="5" fill="var(--amber)" />
          <text className="tn" x={pk.x + 12} y={Math.min(118, pk.y + 16)} style={{ fontSize: 16, fill: "var(--amber-ink)" }}>
            {usd(pk.v)}
          </text>
        </>
      ) : null}
      {last ? <circle cx={last.x} cy={last.y} r="4" fill="var(--amber)" /> : null}
    </>
  )
}
