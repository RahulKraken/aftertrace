import { useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Download, ImageIcon, FileText } from "lucide-react"
import { ModelName, ToolName } from "../components/SpanIcon"
import { Link } from "wouter"
import { api } from "../lib/api"
import { CAT_LABEL, CATS, delta, dur, int, pct, plural, sayDur, sayUsd, usd } from "../lib/format"
import { readPlan } from "../lib/plan"
import { receiptLines, receiptMarkdown, receiptPNG, weekLabel } from "../lib/receipt"
import { useToast } from "../lib/toast"
import type { Recap } from "../lib/types"

export function RecapPage() {
  const [week, setWeek] = useState(0)
  const [r, setR] = useState<Recap | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [showPrompts, setShowPrompts] = useState(false)
  const plan = useMemo(() => readPlan(), [])
  const toast = useToast()

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

  if (err && !r) return <div className="page">{err}</div>
  if (!r) return <div className="page mute">Loading your week…</div>
  const s = r.stats
  const lines = receiptLines(r, plan, showPrompts)
  const dark = document.documentElement.dataset.theme === "dark"

  const copyImage = async () => {
    try {
      const blob = await receiptPNG(lines, dark)
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
      toast("Receipt copied as an image")
    } catch {
      toast("Copy failed. Use Download instead.")
    }
  }
  const download = async () => {
    const blob = await receiptPNG(lines, dark)
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `aftertrace-week-${new Date(r.lo / 1e6).toISOString().slice(0, 10)}.png`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const copyMarkdown = async () => {
    await navigator.clipboard.writeText(receiptMarkdown(r, plan, showPrompts))
    toast("Recap copied as Markdown")
  }

  return (
    <div className="page recap">
      <div className="recap-head">
        <div>
          <h1>Recap</h1>
          <div className="sub">Your week with your agents. A report, not a dashboard.</div>
        </div>
        <div className="recap-nav">
          <button type="button" className="icon-btn" disabled={!r.has_older} onClick={() => setWeek(week + 1)} aria-label="Previous week" title="Previous week">
            <ChevronLeft size={15} />
          </button>
          <span className="num">{weekLabel(r)}</span>
          <button type="button" className="icon-btn" disabled={week === 0} onClick={() => setWeek(week - 1)} aria-label="Next week" title="Next week">
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      <div className="recap-grid">
        <div className="recap-main">
          <p className="recap-story">
            <Story r={r} plan={plan?.monthly ? plan.monthly : 0} />
          </p>

          {r.busiest_day && r.busiest_day.lanes.length > 0 && (
            <section className="home-sec">
              <div className="sec-hd">
                <h2>Your busiest day, in lanes</h2>
                <span className="sec-sub">
                  {new Date(r.busiest_day.day).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })} ·{" "}
                  {dur(r.busiest_day.turn_ms)} of agent time
                </span>
              </div>
              <DayLanes day={r.busiest_day} showPrompts={showPrompts} />
            </section>
          )}

          <section className="home-sec">
            <div className="sec-hd">
              <h2>Where the time went</h2>
            </div>
            <div className="card split-card">
              <div className="phase split-bar">
                {CATS.map((c) => (
                  <i key={c} className={`c-${c}`} style={{ flex: s.breakdown[c] || 0 }} />
                ))}
              </div>
              <div className="split-legend split-inline">
                {CATS.filter((c) => (s.breakdown[c] || 0) > 0).map((c) => (
                  <span key={c} className="split-chip">
                    <i className={`c-${c} split-sw`} /> {CAT_LABEL[c]} <span className="num">{dur(s.breakdown[c] || 0)}</span>
                  </span>
                ))}
              </div>
            </div>
          </section>

          <div className="home-grid">
            <section className="home-sec">
              <div className="sec-hd">
                <h2>Tools you leaned on</h2>
              </div>
              <Bars rows={r.tools.map((t) => ({ k: t.tool, label: <ToolName name={t.tool} />, v: t.calls, sub: `${dur(t.exec_ms)} running${t.wait_ms > 1000 ? ` · ${dur(t.wait_ms)} waiting` : ""}` }))} fmt={int} />
            </section>
            <section className="home-sec">
              <div className="sec-hd">
                <h2>Models</h2>
              </div>
              <Bars rows={r.models.map((m) => ({ k: m.model, label: <ModelName model={m.model} />, v: m.cost_usd, sub: `${int(m.requests)} requests` }))} fmt={usd} />
            </section>
          </div>

          {r.apps.length > 0 && (
            <section className="home-sec">
              <div className="sec-hd">
                <h2>Your apps</h2>
                <Link href="/apps" className="sec-link">
                  Apps
                </Link>
              </div>
              <Bars rows={r.apps.map((a) => ({ k: a.service, v: a.cost_usd, sub: `${int(a.calls)} calls${a.failed ? ` · ${int(a.failed)} failed` : ""}` }))} fmt={usd} />
            </section>
          )}

          <div className="home-grid">
            {r.priciest && r.priciest.cost_usd > 0 && <TurnCard label="Priciest turn" t={r.priciest} value={usd(r.priciest.cost_usd)} showPrompts={showPrompts} />}
            {r.longest && <TurnCard label="Longest turn" t={r.longest} value={dur(r.longest.duration_ms)} showPrompts={showPrompts} />}
          </div>
        </div>

        <aside className="recap-side">
          <div className="receipt" aria-label="Weekly receipt">
            {lines.map((l, i) => (
              <div key={i} className={`rl rl-${l.kind}`}>
                {l.left && <span>{l.left}</span>}
                {l.right && <span>{l.right}</span>}
              </div>
            ))}
            <div className="receipt-edge" aria-hidden="true" />
          </div>
          <div className="receipt-actions">
            <button type="button" className="btn" onClick={copyImage}>
              <ImageIcon size={14} /> Copy image
            </button>
            <button type="button" className="btn ghost" onClick={copyMarkdown}>
              <FileText size={14} /> Markdown
            </button>
            <button type="button" className="btn ghost" onClick={download} aria-label="Download PNG" title="Download PNG">
              <Download size={14} />
            </button>
          </div>
          <label className="opt">
            <input type="checkbox" checked={showPrompts} onChange={(e) => setShowPrompts(e.target.checked)} />
            <span>Show prompts (they can name private projects; off by default for sharing)</span>
          </label>
          {!plan?.monthly && (
            <div className="note">
              Set your plan in <Link href="/settings">Settings</Link> to see whether it paid for itself.
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function Story({ r, plan }: { r: Recap; plan: number }) {
  const s = r.stats
  if (!s.turns) return <>No agent work this week. Pick an earlier week, or start a session.</>
  const d = delta(s.turn_ms, r.prev.turn_ms)
  const wait = s.breakdown.permission_wait || 0
  return (
    <>
      Your agents put in <b>{sayDur(s.turn_ms)}</b> across {int(s.sessions)} {s.sessions === 1 ? "session" : "sessions"} and {int(s.turns)} turns
      {d != null && Number.isFinite(d) && Math.abs(d) >= 0.05 ? (
        <>, {pct(Math.abs(d))} {d > 0 ? "more" : "less"} than the week before</>
      ) : null}
      . You waited on them for <b>{sayDur(wait)}</b>
      {s.approvals ? <> over {int(s.approvals)} {s.approvals === 1 ? "approval" : "approvals"}</> : null}.
      {s.lines_added ? (
        <>
          {" "}
          They shipped <b>{int(s.lines_added)}</b> lines{s.commits ? <> in {plural(s.commits, "commit")}</> : null}
          {s.pull_requests ? <> and {plural(s.pull_requests, "pull request")}</> : null}.
        </>
      ) : null}{" "}
      At API prices the week was worth <b>{sayUsd(s.cost_usd, true)}</b>
      {plan ? <>; your plan cost {sayUsd((plan * 7) / 30, true)} of it.</> : "."}
    </>
  )
}

function DayLanes({ day, showPrompts }: { day: NonNullable<Recap["busiest_day"]>; showPrompts: boolean }) {
  const all = day.lanes.flatMap((l) => l.turns)
  const lo = Math.min(...all.map((t) => t[0]))
  const hi = Math.max(...all.map((t) => t[1]))
  const span = Math.max(hi - lo, 1)
  const hours: number[] = []
  const h0 = new Date(lo / 1e6)
  h0.setMinutes(0, 0, 0)
  for (let t = h0.getTime() * 1e6; t <= hi; t += 3600e9) if (t >= lo) hours.push(t)
  // Under two hour marks, label the first and last turn instead.
  if (hours.length < 2) hours.splice(0, hours.length, lo, hi)
  return (
    <div className="card lanes-card">
      <div className="dl-axis">
        {hours.map((t) => (
          <span key={t} style={{ left: `${((t - lo) / span) * 100}%` }}>
            {new Date(t / 1e6).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          </span>
        ))}
      </div>
      {day.lanes.map((l, i) => (
        <div className="dl-row" key={l.session_id || i}>
          <span className="dl-label">{showPrompts && l.title ? l.title : `Session ${i + 1}`}</span>
          <span className="dl-track">
            {l.turns.map(([a, b], j) => (
              <i key={j} style={{ left: `${((a - lo) / span) * 100}%`, width: `max(3px, ${((b - a) / span) * 100}%)` }} />
            ))}
          </span>
        </div>
      ))}
    </div>
  )
}

function Bars({ rows, fmt }: { rows: { k: string; label?: React.ReactNode; v: number; sub?: string }[]; fmt: (v: number) => string }) {
  if (!rows.length) return <div className="quiet-line">Nothing this week.</div>
  const max = Math.max(...rows.map((r) => r.v), 1e-9)
  return (
    <div className="card bars-card stagger">
      {rows.map((r) => (
        <div className="bar-row" key={r.k}>
          <span className="bar-k">{r.label ?? r.k}</span>
          <span className="bar-track">
            <i style={{ width: `${(r.v / max) * 100}%` }} />
          </span>
          <span className="bar-v num">{fmt(r.v)}</span>
          {r.sub && <span className="bar-sub mute">{r.sub}</span>}
        </div>
      ))}
    </div>
  )
}

function TurnCard({ label, t, value, showPrompts }: { label: string; t: NonNullable<Recap["priciest"]>; value: string; showPrompts: boolean }) {
  return (
    <section className="home-sec">
      <Link href={`/trace/${t.trace_id}`} className="card next-card">
        <div className="stat-label">{label}</div>
        <div className="next-num" style={{ marginTop: 6, display: "block" }}>
          {value}
        </div>
        <div className="next-rec" style={{ marginTop: 8 }}>
          {showPrompts && t.prompt ? `“${t.prompt}”` : `${dur(t.duration_ms)} · ${usd(t.cost_usd)}`}
        </div>
      </Link>
    </section>
  )
}
