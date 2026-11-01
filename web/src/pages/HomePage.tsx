import { useEffect, useMemo, useState } from "react"
import { Link } from "wouter"
import { api } from "../lib/api"
import { clock, hm, remain, runCost, sayTok, usd } from "../lib/format"
import { mondayReset, readBudget } from "../lib/budget"
import { labelDays } from "../lib/chart"
import { modelFamily, modelSlug, primaryModel, usageWindow } from "../lib/model"
import { cardMoney, monthlyUSD, shortTitle } from "../lib/welcome"
import type { DayPoint, LiveLane, ModelSpend, Overview, Session, Turn } from "../lib/types"
import { Meter } from "../components/Meter"
import { ModelChip } from "../components/ModelChip"
import { Money } from "../components/Money"
import { StateChip } from "../components/StateChip"
import { TraceLine } from "../components/TraceLine"

type Range = 7 | 30 | 90
type Tab = "spend" | "tokens" | "savable"

const AMBER = ["var(--amber)", "var(--a2)", "var(--a3)", "var(--a4)"]

export function HomePage() {
  const [ov, setOv] = useState<Overview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [range, setRange] = useState<Range>(30)
  const [tab, setTab] = useState<Tab>("spend")
  const [budget, setBudget] = useState(() => readBudget())
  const [sessions, setSessions] = useState<Session[]>([])
  const [costModels, setCostModels] = useState<ModelSpend[]>([])
  const live = Boolean(ov?.live.length)

  useEffect(() => {
    const on = () => setBudget(readBudget())
    window.addEventListener("aftertrace-budget", on)
    return () => window.removeEventListener("aftertrace-budget", on)
  }, [])

  useEffect(() => {
    let alive = true
    const load = () =>
      Promise.all([api.overview(), api.sessions(), api.cost("model")])
        .then(([o, ss, cost]) => {
          if (!alive) return
          setOv(o)
          setSessions(ss)
          setErr(null)
          const mi = cost.columns.indexOf("model")
          const ci = cost.columns.indexOf("cost_usd")
          const rows: ModelSpend[] = (cost.rows || []).map((r) => ({
            model: String(r[mi] ?? ""),
            cost_usd: Number(r[ci] || 0),
          }))
          setCostModels(rows)
        })
        .catch((e: Error) => alive && setErr(e.message))
    load()
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
  if (!ov) return <div className="v4"><div className="v4-empty">Loading…</div></div>
  if (!ov.has_data) return <DesignedEmpty title="Overview" line="No sessions yet." />

  return (
    <HomeBody
      ov={ov}
      sessions={sessions}
      costModels={costModels}
      range={range}
      setRange={setRange}
      tab={tab}
      setTab={setTab}
      budget={budget?.weekly ?? null}
    />
  )
}

function HomeBody({
  ov,
  sessions,
  costModels,
  range,
  setRange,
  tab,
  setTab,
  budget,
}: {
  ov: Overview
  sessions: Session[]
  costModels: ModelSpend[]
  range: Range
  setRange: (r: Range) => void
  tab: Tab
  setTab: (t: Tab) => void
  budget: number | null
}) {
  const days = useMemo(() => sliceDays(ov.days, range), [ov.days, range])
  const spend = days.reduce((a, d) => a + (d.cost_usd || 0), 0)
  const tokens = range === 7 ? ov.week.tokens : days.reduce((a, d) => a + dayTokens(d), 0)
  const savings = ov.savings
  const savable = savings?.total_monthly || 0
  const observed = savings?.observed_monthly || spend
  const models = modelsFromDays(days, costModels)
  const weekDays = sliceDays(ov.days, 7)
  const weekSpend = ov.week.cost_usd
  const win = usageWindow(ov.now, [
    ...sessions.map((s) => s.start_ns),
    ...ov.live.map((l) => l.start_ns),
  ])
  const live = ov.live[0]
  const liveSession = live ? sessions.find((s) => s.session_id === live.session_id) : undefined

  return (
    <div className="v4 home">
      <div className="v4-ph">
        <h1>Overview</h1>
        <div className="v4-seg" role="tablist" aria-label="Range">
          {([7, 30, 90] as Range[]).map((n) => (
            <button type="button" key={n} className={range === n ? "on" : ""} onClick={() => setRange(n)}>
              {n}D
            </button>
          ))}
        </div>
      </div>

      <div className="v4-g">
        <section className="v4-card">
          <div className="v4-tabs">
            <button type="button" className={tab === "spend" ? "on" : ""} onClick={() => setTab("spend")}>
              <div className="v4-lbl">Spend</div>
              <div className="v4-num"><Money value={spend} /></div>
            </button>
            <button type="button" className={tab === "tokens" ? "on" : ""} onClick={() => setTab("tokens")}>
              <div className="v4-lbl">Tokens</div>
              <div className="v4-num mono">{tokens ? sayTok(tokens) : "—"}</div>
            </button>
            <button type="button" className={`amb${tab === "savable" ? " on" : ""}`} onClick={() => setTab("savable")}>
              <div className="v4-lbl">Savable</div>
              <div className="v4-num">
                <Money value={savable} />
                {spend > 0 && savable > 0 ? <span className="v4-delta">{Math.round((savable / Math.max(observed, spend)) * 100)}%</span> : null}
              </div>
            </button>
          </div>
          <div className="v4-chart">
            <DayChart days={days} tab={tab} savings={savable} spend={spend} />
          </div>
          {models.length > 0 && (
            <div className="v4-leg">
              {models.map((m) => (
                <span className="x" key={m.model}>
                  <ModelChip model={m.model} />
                  <span className="v4-money">{usd(m.cost_usd)}</span>
                  {m.tokens ? <span className="v4-tk">{sayTok(m.tokens)}</span> : null}
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="v4-card v4-bud">
          <div className="v4-lbl">{budget ? "Budget" : "This week"}</div>
          <div className="v4-big v4-money">
            <Money value={weekSpend} />
            {budget ? <span className="of">/ {usd(budget)}</span> : null}
          </div>
          {budget ? (
            <Meter
              fill={weekSpend / budget}
              left={`${Math.round((weekSpend / budget) * 100)}%`}
              right={
                <>
                  {mondayReset().label} · <b>{remain(mondayReset().ms)}</b>
                </>
              }
            />
          ) : (
            <div className="v4-rs" style={{ marginTop: 10 }}>
              <span>No cap set</span>
              <Link href="/settings" className="v4-dim">
                Settings
              </Link>
            </div>
          )}
          <div className="v4-wk">
            <WeekBars days={weekDays} budget={budget} />
          </div>
          {win && (
            <>
              <div className="v4-sep" />
              <WindowCard win={win} />
            </>
          )}
        </section>
      </div>

      <div className="v4-g">
        <NowCard
          live={live}
          session={liveSession}
          last={!live && ov.history_only ? sessions[0] : undefined}
          historyOnly={Boolean(ov.history_only)}
        />
        <SavableCard savings={savings} spend={observed || spend} />
      </div>
    </div>
  )
}

function DesignedEmpty({ title, line }: { title: string; line: string }) {
  return (
    <div className="v4">
      <div className="v4-ph"><h1>{title}</h1></div>
      <section className="v4-card v4-empty">{line}</section>
    </div>
  )
}

function WindowCard({ win }: { win: NonNullable<ReturnType<typeof usageWindow>> }) {
  const used = hm(win.elapsed_ns / 1e6)
  const left = remain(win.left_ns / 1e6)
  return (
    <div className="w2 v4-meter">
      <div className="v4-lbl">5h window</div>
      <div className="v4-num">
        {used.h}
        <small>h</small>
        {used.m}
        <small>m</small>
        <small>/ 5h</small>
      </div>
      <Meter
        fill={win.elapsed_ns / (5 * 3600e9)}
        time
        left={clock(win.start_ns)}
        right={
          <>
            resets {clock(win.end_ns)} · <b>{left}</b>
          </>
        }
      />
    </div>
  )
}

function NowCard({
  live,
  session,
  last,
  historyOnly,
}: {
  live?: LiveLane
  session?: Session
  last?: Session
  historyOnly: boolean
}) {
  const sid = live?.session_id || last?.session_id
  const [turns, setTurns] = useState<Turn[]>([])
  useEffect(() => {
    if (!sid) return
    api.session(sid).then((d) => setTurns(d.turns || [])).catch(() => setTurns([]))
  }, [sid])
  if (!live && last) {
    const model = primaryModel(last.models || turns.flatMap((t) => t.models || []))
    const values = turns.length ? turns.map((t) => t.cost_usd || t.duration_ms || 0) : [last.cost_usd || 0.1]
    return (
      <section className="v4-card v4-now">
        <div className="hd">
          <span className="v4-st done"><i />Last session</span>
          {model ? <ModelChip model={model} /> : null}
          <span className="v4-when">{clock(last.start_ns)} → {clock(last.end_ns)}</span>
        </div>
        <Link href={`/session/${last.session_id}`} className="t">
          {last.title || "Last session"}
        </Link>
        <div className="m">
          <span className="v4-tk"><b>{last.turns}</b> turns</span>
          {last.tokens ? <span className="v4-tk"><b>{sayTok(last.tokens)}</b> tok</span> : null}
          <span className="v4-tk"><b>{usd(runCost(last))}</b></span>
        </div>
        <TraceLine values={values} width={700} height={112} sw={1.5} r={3.5} tail={0.3} />
        <div className="ax">
          <span>{clock(last.start_ns)}</span>
          <span>{clock(last.end_ns)}</span>
        </div>
      </section>
    )
  }
  if (!live) {
    return (
      <section className="v4-card v4-now">
        <div className="hd">
          <span className="v4-st done"><i />Idle</span>
        </div>
        <div className="t">{historyOnly ? "History only." : "Nothing running."}</div>
      </section>
    )
  }
  const model = primaryModel(session?.models || turns.flatMap((t) => t.models || []))
  const cost = runCost(session, live)
  const values = turns.length ? turns.map((t) => t.cost_usd || t.duration_ms || 0) : [cost || 0.1]
  return (
    <section className="v4-card v4-now">
      <div className="hd">
        <StateChip running />
        {model ? <ModelChip model={model} /> : null}
        <span className="v4-when">{clock(live.start_ns)} → {clock(live.last_ns)}</span>
      </div>
      <Link href={`/trace/${live.trace_id}`} className="t">
        {live.title || live.doing || "Live run"}
      </Link>
      <div className="m">
        {session?.turns ? <span className="v4-tk"><b>{session.turns}</b> turns</span> : <span className="v4-tk"><b>{live.spans}</b> spans</span>}
        {session?.tokens ? <span className="v4-tk"><b>{sayTok(session.tokens)}</b> tok</span> : null}
        <span className="v4-tk"><b>{usd(cost)}</b></span>
      </div>
      <TraceLine values={values} width={700} height={112} live sw={1.5} r={3.5} tail={0.3} />
      <div className="ax">
        <span>{clock(live.start_ns)}</span>
        <span>{clock(live.last_ns)}</span>
      </div>
    </section>
  )
}

function SavableCard({
  savings,
  spend,
}: {
  savings?: Overview["savings"]
  spend: number
}) {
  const shown = savings?.shown || []
  const fold = savings?.folded || 0
  const total = savings?.total_monthly || 0
  const lean = total < 1
  return (
    <section className="v4-card v4-sv">
      <div className="v4-lbl">Savable / mo</div>
      <div className="v4-big v4-money">
        <Money value={total} />
        {spend > 0 ? <span className="of">/ {usd(spend)}</span> : null}
      </div>
      <div className="v4-sbar">
        {shown.map((f, i) => {
          const m = typeof f.monthly_usd === "number" ? f.monthly_usd : monthlyUSD(f)
          const w = spend > 0 ? (m / spend) * 100 : 0
          return <i key={f.id} style={{ width: `${Math.max(w, 0.4)}%`, background: AMBER[i] || "var(--a4)" }} />
        })}
        {fold > 0 && spend > 0 ? (
          <i style={{ width: `${Math.max(((savings?.folded_monthly || 0) / spend) * 100, 0.4)}%`, background: "var(--a4)" }} />
        ) : null}
        <i style={{ flex: 1, background: "var(--bar-2)" }} />
      </div>
      {lean && !shown.length ? (
        <div className="v4-li">
          <span className="nm v4-dim">{savings?.headline || "Your setup looks lean."}</span>
        </div>
      ) : null}
      {shown.map((f, i) => {
        const m = typeof f.monthly_usd === "number" ? f.monthly_usd : monthlyUSD(f)
        return (
          <Link key={f.id} href={`/findings?focus=${f.id}`} className="v4-li next-card">
            <span className="v4-dot" style={{ background: AMBER[i] || "var(--a4)" }} />
            <span className="nm">{shortTitle(f)}</span>
            <span className="v">{cardMoney(m).replace("/month", "").replace("~", "") || usd(m)}</span>
          </Link>
        )
      })}
      {fold > 0 && (
        <Link href="/findings" className="v4-li">
          <span className="v4-dot" style={{ background: "var(--a4)" }} />
          <span className="nm v4-dim">+{fold} more</span>
          <span className="v v4-dim">{usd(savings?.folded_monthly || 0)}</span>
        </Link>
      )}
    </section>
  )
}

function DayChart({
  days,
  tab,
  savings,
  spend,
}: {
  days: DayPoint[]
  tab: Tab
  savings: number
  spend: number
}) {
  const w = 700
  const h = 290
  const padL = 34
  const padB = 26
  const padT = 16
  const innerH = h - padB - padT
  const n = Math.max(days.length, 1)
  const barW = Math.max(4, Math.min(12, ((w - padL - 8) / n) * 0.42))
  const gap = (w - padL - 8) / n
  const values = days.map((d) => (tab === "tokens" ? dayTokens(d) : d.cost_usd))
  const max = Math.max(...values, 1e-6)
  const ticks = niceAxis(max, tab === "tokens")
  const maxTick = ticks[ticks.length - 1] || max
  return (
    <svg viewBox={`0 0 ${w} ${h}`}>
      {ticks.map((t) => {
        const y = padT + innerH - (t / maxTick) * innerH
        return (
          <g key={t}>
            <line x1={padL} x2={w - 4} y1={y} y2={y} stroke="var(--grid)" />
            <text className="v4-tick" x={padL - 8} y={y + 4} textAnchor="end">
              {tab === "tokens" ? sayTok(t) : t >= 1 ? `$${Math.round(t)}` : `$${t.toFixed(0)}`}
            </text>
          </g>
        )
      })}
      {days.map((d, i) => {
        const x = padL + 6 + i * gap
        const total = values[i]
        const bh = (total / maxTick) * innerH
        if (tab === "savable") {
          const share = spend > 0 ? savings / spend : 0
          const sh = bh * share
          return (
            <g key={d.start_ns}>
              <rect x={x} y={padT + innerH - bh} width={barW} height={Math.max(bh - sh, 0)} rx="1.5" fill="var(--bar)" />
              <rect x={x} y={padT + innerH - sh} width={barW} height={sh} rx="1.5" fill="var(--amber)" />
            </g>
          )
        }
        const parts = d.by_model && d.by_model.length ? d.by_model : [{ model: "other", cost_usd: d.cost_usd }]
        const sum = parts.reduce((a, p) => a + p.cost_usd, 0) || 1
        let y = padT + innerH
        return (
          <g key={d.start_ns}>
            {[...parts].reverse().map((p) => {
              const ph = bh * (p.cost_usd / sum)
              y -= ph
              return (
                <rect
                  key={p.model}
                  x={x}
                  y={y}
                  width={barW}
                  height={Math.max(ph, 0)}
                  rx="1.5"
                  fill={modelFamily(p.model) === "opus" ? "var(--m-opus)" : modelFamily(p.model) === "sonnet" ? "var(--m-son)" : "var(--bar)"}
                />
              )
            })}
          </g>
        )
      })}
      {labelDays(days).map((l) => (
        <text key={l.i} className="v4-tick" x={padL + 6 + l.i * gap + barW / 2} y={h - 8} textAnchor="middle">
          {l.label}
        </text>
      ))}
    </svg>
  )
}

function WeekBars({ days, budget }: { days: DayPoint[]; budget: number | null }) {
  const w = 340
  const h = 92
  const max = Math.max(...days.map((d) => d.cost_usd), budget ? budget / 7 : 0, 0.01)
  const n = 7
  const gap = (w - 8) / n
  const barW = 14
  const days7 = padWeek(days)
  const paceY = budget ? 66 - ((budget / 7) / max) * 52 : -1
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ display: "block", width: "100%" }}>
      <line x1="4" x2={w - 4} y1="66" y2="66" stroke="var(--line)" />
      {paceY > 0 && <line x1="4" x2={w - 4} y1={paceY} y2={paceY} stroke="var(--t2)" strokeDasharray="3 3" />}
      {days7.map((d, i) => {
        const x = 20.7 + i * gap
        const parts = d.by_model && d.by_model.length ? d.by_model : [{ model: "other", cost_usd: d.cost_usd }]
        const tot = parts.reduce((a, p) => a + p.cost_usd, 0)
        const bh = (tot / max) * 52
        let y = 66
        return (
          <g key={i}>
            {[...parts].reverse().map((p) => {
              const ph = tot > 0 ? bh * (p.cost_usd / tot) : 0
              y -= ph
              return (
                <rect
                  key={p.model}
                  x={x}
                  y={y}
                  width={barW}
                  height={Math.max(ph, 0)}
                  rx="1.5"
                  fill={modelFamily(p.model) === "opus" ? "var(--m-opus)" : modelFamily(p.model) === "sonnet" ? "var(--m-son)" : "var(--bar)"}
                />
              )
            })}
            <text className="v4-tick" x={x + barW / 2} y="84" textAnchor="middle">
              {["S", "M", "T", "W", "T", "F", "S"][new Date(d.start_ns / 1e6).getDay()] || ""}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function sliceDays(days: DayPoint[], n: number): DayPoint[] {
  if (!days.length) return []
  return days.slice(-n)
}

function padWeek(days: DayPoint[]): DayPoint[] {
  const last = days[days.length - 1]
  if (!last) {
    return Array.from({ length: 7 }, (_, i) => ({
      day: "",
      start_ns: Date.now() * 1e6 - (6 - i) * 86400e9,
      cost_usd: 0,
      turn_ms: 0,
      wait_ms: 0,
      turns: 0,
    }))
  }
  const end = new Date(last.start_ns / 1e6)
  const out: DayPoint[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(end)
    d.setDate(end.getDate() - i)
    d.setHours(0, 0, 0, 0)
    const hit = days.find((x) => Math.abs(x.start_ns / 1e6 - d.getTime()) < 12 * 3600e3)
    out.push(hit || { day: "", start_ns: d.getTime() * 1e6, cost_usd: 0, turn_ms: 0, wait_ms: 0, turns: 0 })
  }
  return out
}

function modelsFromDays(days: DayPoint[], fallback: ModelSpend[]): ModelSpend[] {
  const m = new Map<string, ModelSpend>()
  for (const d of days) {
    for (const p of d.by_model || []) {
      const k = modelSlug(p.model)
      const cur = m.get(k) || { model: p.model, cost_usd: 0, tokens: 0 }
      cur.cost_usd += p.cost_usd
      cur.tokens = (cur.tokens || 0) + (p.tokens || 0)
      m.set(k, cur)
    }
  }
  if (m.size) return [...m.values()].sort((a, b) => b.cost_usd - a.cost_usd)
  return fallback.slice(0, 4)
}

function dayTokens(d: DayPoint): number {
  return (d.by_model || []).reduce((a, p) => a + (p.tokens || 0), 0)
}

function niceAxis(max: number, tokens: boolean): number[] {
  if (tokens) {
    const step = max > 5e6 ? 5e6 : max > 1e6 ? 1e6 : 2e5
    const out = [0]
    for (let t = step; t < max * 1.05; t += step) out.push(t)
    return out
  }
  const nice = [1, 2, 3, 5, 10, 20, 30, 50, 100]
  const step = nice.find((n) => max / n <= 3) || Math.ceil(max / 3)
  const out = [0]
  for (let t = step; t < max * 1.05; t += step) out.push(t)
  if (out.length < 2) out.push(step)
  return out
}


