import { useEffect, useState } from "react"
import { ArrowRight, Plug } from "lucide-react"
import { Link, useLocation } from "wouter"
import { api } from "../lib/api"
import { ago, CAT_LABEL, CATS, delta, dur, impactParts, int, pct, plural, usd, when } from "../lib/format"
import { planMultiple, readPlan } from "../lib/plan"
import type { Breakdown, LiveLane, Overview, WindowStats } from "../lib/types"
import { MiniWaterfall } from "../components/MiniWaterfall"
import { Sparkline } from "../components/Sparkline"
import { useNow } from "../hooks/useNow"

export function HomePage() {
  const [ov, setOv] = useState<Overview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const live = Boolean(ov?.live.length)

  useEffect(() => {
    let alive = true
    const load = () =>
      api
        .overview()
        .then((o) => {
          if (!alive) return
          setOv(o)
          setErr(null)
        })
        .catch((e: Error) => alive && setErr(e.message))
    load()
    // Live lanes refresh fast while something runs; otherwise every 30s.
    const t = window.setInterval(load, live ? 4000 : 30000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [live])

  if (err && !ov) {
    return (
      <div className="page">
        {err}
        <div className="err-next">Check that aftertrace serve is still running, then reload.</div>
      </div>
    )
  }
  if (!ov) return <HomeSkeleton />
  if (!ov.has_data) return <FirstRun />

  const w = ov.week
  return (
    <div className="page home">
      <div className="home-head">
        <div className="home-date">
          {ov.anchored ? `Week ending ${when(ov.hi).date}` : "This week"}
          {live && (
            <span className="run-pill" title="Turns in progress">
              {ov.live.length} running
            </span>
          )}
        </div>
        <h1 className="home-story">
          <Story w={w} days={7} />
        </h1>
      </div>

      <StatStrip ov={ov} />

      <section className="home-sec">
        <div className="sec-hd">
          <h2>Live now</h2>
          <span className="sec-sub">Turns in progress, updated every few seconds</span>
        </div>
        {ov.live.length ? (
          <div className="lanes">
            {ov.live.map((l) => (
              <Lane key={l.trace_id} lane={l} now={ov.now} />
            ))}
          </div>
        ) : (
          <div className="quiet-line">Nothing running. When an agent starts a turn it shows up here within seconds.</div>
        )}
      </section>

      <div className="home-grid">
        <section className="home-sec">
          <div className="sec-hd">
            <h2>Do this next</h2>
            {ov.open > 1 && (
              <Link href="/findings" className="sec-link">
                {ov.open} findings <ArrowRight size={13} />
              </Link>
            )}
          </div>
          {ov.top ? <NextFinding f={ov.top} /> : <div className="card quiet-card">No findings yet. Rules run on every refresh as data arrives.</div>}
        </section>
        <section className="home-sec">
          <div className="sec-hd">
            <h2>Where the time went</h2>
            <span className="sec-sub">{dur(w.turn_ms)} of agent time</span>
          </div>
          <TimeSplit bd={w.breakdown} />
        </section>
      </div>

      <section className="home-sec">
        <div className="sec-hd">
          <h2>Recent sessions</h2>
          <Link href="/sessions" className="sec-link">
            All sessions <ArrowRight size={13} />
          </Link>
        </div>
        <RecentList ov={ov} />
      </section>

      <section className="home-sec">
        <div className="sec-hd">
          <h2>Sources</h2>
          <Link href="/connect" className="sec-link">
            Connect a source <ArrowRight size={13} />
          </Link>
        </div>
        <div className="src-chips">
          {ov.sources.map((s) => (
            <span key={s.name} className={`src-chip${s.live ? " is-live" : ""}`} title={`${int(s.spans)} spans, ${int(s.events)} events, ${int(s.metrics)} metric points`}>
              <i className="recv-dot" />
              <span>{s.name}</span>
              <span className="mute">{s.kind === "app" ? "app" : "Claude Code"} · {ago(s.last_ns)}</span>
            </span>
          ))}
        </div>
      </section>
    </div>
  )
}

// One sentence, in English, with the most important fact emphasised
// (design.md: story first). Fun numbers only with a baseline.
function Story({ w, days }: { w: WindowStats; days: number }) {
  if (!w.turns) return <>No agent work this week yet. Your next session will show up here.</>
  const wait = w.breakdown.permission_wait || 0
  const plan = readPlan()
  const mult = planMultiple(plan, w.cost_usd, days)
  return (
    <>
      Your agents worked <b>{dur(w.turn_ms)}</b> across {w.sessions} {w.sessions === 1 ? "session" : "sessions"}
      {w.cost_usd > 0 && (
        <>
          {" "}for <b>{usd(w.cost_usd)}</b>
        </>
      )}
      .{" "}
      {wait / Math.max(w.turn_ms, 1) >= 0.08 ? (
        <>
          <span className="hl-wait">{dur(wait)}</span> of that was waiting on you.
        </>
      ) : w.lines_added > 0 ? (
        <>
          They wrote <b>{int(w.lines_added)}</b> lines{w.commits > 0 && <> and made {plural(w.commits, "commit")}</>}.
        </>
      ) : (
        <>You waited on them for only {dur(wait)}.</>
      )}
      {mult != null && mult >= 1 && (
        <>
          {" "}Your plan paid for itself <b>{mult.toFixed(1)}×</b>.
        </>
      )}
    </>
  )
}

function StatStrip({ ov }: { ov: Overview }) {
  const w = ov.week
  const p = ov.prev
  const days = ov.days.slice(-7)
  const stats: { label: string; value: string; d: number | null; goodDown?: boolean; spark?: number[]; tone?: "ink" | "wait" | "model"; sub?: string }[] = [
    { label: "Agent time", value: dur(w.turn_ms), d: delta(w.turn_ms, p.turn_ms), spark: days.map((x) => x.turn_ms), tone: "model" },
    {
      label: "Waiting on you",
      value: dur(w.breakdown.permission_wait || 0),
      d: delta(w.breakdown.permission_wait || 0, p.breakdown.permission_wait || 0),
      goodDown: true,
      spark: days.map((x) => x.wait_ms),
      tone: "wait",
      sub: w.approvals ? `${int(w.approvals)} ${w.approvals === 1 ? "approval" : "approvals"}` : undefined,
    },
    { label: "API value", value: usd(w.cost_usd), d: delta(w.cost_usd, p.cost_usd), goodDown: true, spark: days.map((x) => x.cost_usd), sub: `${int(w.requests)} requests` },
    {
      label: "Shipped",
      value: w.lines_added ? `+${int(w.lines_added)}` : "—",
      d: delta(w.lines_added, p.lines_added),
      sub: [w.commits ? plural(w.commits, "commit") : "", w.pull_requests ? plural(w.pull_requests, "PR") : ""].filter(Boolean).join(" · ") || "lines added",
    },
    { label: "Cache hit", value: w.cache_hit == null ? "—" : pct(w.cache_hit), d: null, sub: `${int(w.tokens / 1e6)}M tokens` },
  ]
  return (
    <div className="stat-strip">
      {stats.map((s) => (
        <div className="stat" key={s.label}>
          <div className="stat-label">{s.label}</div>
          <div className="stat-row">
            <span className="stat-val">{s.value}</span>
            {s.spark && <Sparkline values={s.spark} tone={s.tone} />}
          </div>
          <div className="stat-foot">
            {s.d != null && Number.isFinite(s.d) && Math.abs(s.d) >= 0.01 ? (
              <span className={`stat-d ${(s.d < 0) === Boolean(s.goodDown) ? "good" : "bad"}`}>
                {s.d > 0 ? "↑" : "↓"} {pct(Math.abs(s.d))}
              </span>
            ) : null}
            {s.sub && <span className="mute">{s.sub}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

function Lane({ lane, now }: { lane: LiveLane; now: number }) {
  const [, nav] = useLocation()
  // Server and browser share a clock (both on this machine), so elapsed ticks
  // locally between polls and the lane feels alive.
  const clock = useNow(1000)
  void now
  const elapsed = (clock * 1e6 - lane.start_ns) / 1e6
  return (
    <button type="button" className={`lane${lane.quiet ? " is-quiet" : ""}`} onClick={() => nav(`/trace/${lane.trace_id}`)}>
      <i className="lane-dot" />
      <span className="lane-main">
        <span className="lane-title">{lane.title || `Session ${lane.session_id.slice(0, 8)}`}</span>
        <span className="lane-doing mono">{lane.quiet ? `quiet for ${ago(lane.last_ns, clock).replace(" ago", "")} · last: ${lane.doing}` : lane.doing}</span>
      </span>
      <span className="lane-meta num">
        <span>{dur(Math.max(elapsed, 0))}</span>
        <span className="mute">{int(lane.spans)} spans</span>
        <span>{usd(lane.cost_usd)}</span>
      </span>
      <ArrowRight size={14} className="lane-go" />
    </button>
  )
}

function NextFinding({ f }: { f: NonNullable<Overview["top"]> }) {
  const [imp, unit] = impactParts(f)
  return (
    <Link href={`/findings?focus=${f.id}`} className="card next-card">
      <div className="next-imp">
        <span className="next-num">{imp}</span> <span className="mute">{unit}</span>
      </div>
      <div className="next-head">{f.headline}</div>
      <div className="next-rec">{f.recommendation}</div>
      <span className="sec-link">
        See the fix <ArrowRight size={13} />
      </span>
    </Link>
  )
}

function TimeSplit({ bd }: { bd: Breakdown }) {
  const tot = CATS.reduce((a, c) => a + (bd[c] || 0), 0) || 1
  const shown = CATS.filter((c) => (bd[c] || 0) / tot >= 0.005)
  return (
    <div className="card split-card">
      <div className="phase split-bar">
        {CATS.map((c) => (
          <i key={c} className={`c-${c}`} style={{ flex: bd[c] || 0 }} title={`${CAT_LABEL[c]} ${dur(bd[c] || 0)}`} />
        ))}
      </div>
      <div className="split-legend">
        {shown.map((c) => (
          <div key={c} className="split-row">
            <i className={`c-${c} split-sw`} />
            <span>{CAT_LABEL[c]}</span>
            <span className="num">{dur(bd[c] || 0)}</span>
            <span className="num mute">{pct((bd[c] || 0) / tot)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function RecentList({ ov }: { ov: Overview }) {
  const [, nav] = useLocation()
  if (!ov.recent.length) return <div className="quiet-line">No sessions yet.</div>
  return (
    <div className="card list-card">
      {ov.recent.map((s) => {
        const t = when(s.start_ns)
        return (
          <button type="button" key={s.session_id} className="list-row" onClick={() => nav(`/session/${s.session_id}`)}>
            <MiniWaterfall bd={s.breakdown} turns={s.turns} />
            <span className="list-title">
              {s.title || s.repo || <span className="mono mute">{s.session_id.slice(0, 8)}</span>}
              {s.running && <span className="run-pill">running</span>}
            </span>
            <span className="num mute">
              {t.date} {t.time}
            </span>
            <span className="num mute">{s.turns} turns</span>
            <span className="num">{dur(s.turn_ms)}</span>
            <span className="num">{usd(s.cost_usd)}</span>
          </button>
        )
      })}
    </div>
  )
}

function FirstRun() {
  return (
    <div className="page">
      <div className="first-run">
        <div className="fr-mark">
          <Plug size={18} />
        </div>
        <h1>Nothing on the wire yet</h1>
        <p>Aftertrace is running and listening on this machine. Connect Claude Code, an agent or one of your apps, and your first session shows up here within seconds.</p>
        <Link href="/connect" className="btn">
          Connect a source <ArrowRight size={14} />
        </Link>
        <div className="mute fr-alt">
          Just looking? Run <code>aftertrace demo</code> to load six synthetic sessions.
        </div>
      </div>
    </div>
  )
}

function HomeSkeleton() {
  return (
    <div className="page home" aria-busy="true">
      <div className="sk sk-line" style={{ width: 120 }} />
      <div className="sk sk-title" />
      <div className="stat-strip">
        {[0, 1, 2, 3, 4].map((i) => (
          <div className="stat" key={i}>
            <div className="sk sk-line" style={{ width: 70 }} />
            <div className="sk sk-num" />
          </div>
        ))}
      </div>
    </div>
  )
}
