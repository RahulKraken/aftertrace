import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ArrowRight, Plug } from "lucide-react"
import { Link, useLocation } from "wouter"
import { api } from "../lib/api"
import { ago, CAT_LABEL, CATS, delta, dur, impactFormat, impactParts, int, pct, plural, usd, when } from "../lib/format"
import { planMultiple, readPlan } from "../lib/plan"
import type { Breakdown, LiveLane, Overview, WindowStats } from "../lib/types"
import { MiniWaterfall } from "../components/MiniWaterfall"
import { Sparkline } from "../components/Sparkline"
import { Num } from "../components/Num"
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
      <div className={`home-head${live ? " is-live" : ""}`}>
        <HeroMark live={live} />
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
          <div className="lanes stagger">
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
      Your agents worked <b><Num value={w.turn_ms} format={dur} /></b> across {w.sessions} {w.sessions === 1 ? "session" : "sessions"}
      {w.cost_usd > 0 && (
        <>
          {" "}for <b><Num value={w.cost_usd} format={usd} /></b>
        </>
      )}
      .{" "}
      {wait / Math.max(w.turn_ms, 1) >= 0.08 ? (
        <>
          <span className="hl-wait"><Num value={wait} format={dur} /></span> of that was waiting on you.
        </>
      ) : w.lines_added > 0 ? (
        <>
          They wrote <b><Num value={w.lines_added} format={(n) => int(Math.round(n))} /></b> lines{w.commits > 0 && <> and made {plural(w.commits, "commit")}</>}.
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
  const labels = days.map((x) => x.day)
  const stats: { label: string; n: number | null; fmt: (n: number) => string; d: number | null; goodDown?: boolean; spark?: number[]; tone?: "ink" | "wait" | "model"; sub?: string }[] = [
    { label: "Agent time", n: w.turn_ms, fmt: dur, d: delta(w.turn_ms, p.turn_ms), spark: days.map((x) => x.turn_ms), tone: "model" },
    {
      label: "Waiting on you",
      n: w.breakdown.permission_wait || 0,
      fmt: dur,
      d: delta(w.breakdown.permission_wait || 0, p.breakdown.permission_wait || 0),
      goodDown: true,
      spark: days.map((x) => x.wait_ms),
      tone: "wait",
      sub: w.approvals ? `${int(w.approvals)} ${w.approvals === 1 ? "approval" : "approvals"}` : undefined,
    },
    { label: "API value", n: w.cost_usd, fmt: usd, d: delta(w.cost_usd, p.cost_usd), goodDown: true, spark: days.map((x) => x.cost_usd), sub: `${int(w.requests)} requests` },
    {
      label: "Shipped",
      n: w.lines_added || null,
      fmt: (n) => `+${int(Math.round(n))}`,
      d: delta(w.lines_added, p.lines_added),
      sub: [w.commits ? plural(w.commits, "commit") : "", w.pull_requests ? plural(w.pull_requests, "PR") : ""].filter(Boolean).join(" · ") || "lines added",
    },
    { label: "Cache hit", n: w.cache_hit, fmt: pct, d: null, sub: `${int(w.tokens / 1e6)}M tokens` },
  ]
  return (
    <div className="stat-strip stagger">
      {stats.map((s) => (
        <div className="stat" key={s.label}>
          <div className="stat-label">{s.label}</div>
          <div className="stat-row">
            <span className="stat-val">{s.n == null ? "—" : <Num value={s.n} format={s.fmt} />}</span>
            {s.spark && <Sparkline values={s.spark} labels={labels} format={s.fmt} tone={s.tone} />}
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
        {/* Each new step slides in under the last, so you can watch the agent move. */}
        <span className="lane-doing-wrap">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={lane.quiet ? "quiet" : lane.doing}
              className="lane-doing"
              initial={{ opacity: 0, transform: "translateY(8px)" }}
              animate={{ opacity: 1, transform: "translateY(0px)", transition: { duration: 0.32, ease: [0.23, 1, 0.32, 1] } }}
              exit={{ opacity: 0, transform: "translateY(-8px)", transition: { duration: 0.18, ease: [0.23, 1, 0.32, 1] } }}
            >
              {lane.quiet ? `Quiet for ${ago(lane.last_ns, clock).replace(" ago", "")} · last: ${lane.doing}` : lane.doing}
            </motion.span>
          </AnimatePresence>
        </span>
      </span>
      <span className="lane-meta num">
        <span>{dur(Math.max(elapsed, 0))}</span>
        <span className="mute">
          <Num value={lane.spans} format={(n) => `${int(Math.round(n))} spans`} />
        </span>
        <span>
          <Num value={lane.cost_usd} format={usd} />
        </span>
      </span>
      <ArrowRight size={14} className="lane-go" />
    </button>
  )
}

function NextFinding({ f }: { f: NonNullable<Overview["top"]> }) {
  const [, unit] = impactParts(f)
  return (
    <Link href={`/findings?focus=${f.id}`} className="card next-card">
      <div className="next-imp">
        <span className="next-num">
          <Num value={f.impact_value} format={impactFormat(f)} />
        </span> <span className="mute">{unit}</span>
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
  // Pointing at a category lights its share of the bar and dims the rest (mapping).
  const [focus, setFocus] = useState<string | null>(null)
  const tot = CATS.reduce((a, c) => a + (bd[c] || 0), 0) || 1
  const shown = CATS.filter((c) => (bd[c] || 0) / tot >= 0.005)
  return (
    <div className={`card split-card${focus ? " has-focus" : ""}`} onMouseLeave={() => setFocus(null)}>
      <div className="phase split-bar grow-bars">
        {CATS.map((c, i) => (
          <i
            key={c}
            className={`c-${c}${focus === c ? " is-focus" : ""}`}
            style={{ flex: bd[c] || 0, ["--i" as string]: i }}
            title={`${CAT_LABEL[c]} ${dur(bd[c] || 0)}`}
            onMouseEnter={() => setFocus(c)}
          />
        ))}
      </div>
      <div className="split-legend">
        {shown.map((c) => (
          <div key={c} className={`split-row${focus === c ? " is-focus" : ""}`} onMouseEnter={() => setFocus(c)}>
            <i className={`c-${c} split-sw`} />
            <span>{CAT_LABEL[c]}</span>
            <span className="num">
              <Num value={bd[c] || 0} format={dur} />
            </span>
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
    <div className="card list-card stagger">
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
        <h1>No sessions yet</h1>
        <p>
          No Claude Code history on this machine, and nothing on the wire. Connect Claude Code and your first turn shows up here
          within seconds.
        </p>
        <Link href="/connect" className="btn">
          Connect Claude Code <ArrowRight size={14} />
        </Link>
        <div className="mute fr-alt">
          Just looking? Run <code>aftertrace demo</code> to load seven synthetic sessions.
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

// The brand mark, large and quiet behind the week's sentence: three bars draw
// in once, and while a turn is running the amber one (waiting on you) breathes.
function HeroMark({ live }: { live: boolean }) {
  return (
    <svg className={`hero-mark${live ? " is-live" : ""}`} viewBox="0 0 240 120" aria-hidden="true">
      <rect className="hm-bar hm-1" x="10" y="16" width="130" height="22" rx="11" />
      <rect className="hm-bar hm-2" x="60" y="49" width="160" height="22" rx="11" />
      <rect className="hm-bar hm-3" x="110" y="82" width="86" height="22" rx="11" />
    </svg>
  )
}
