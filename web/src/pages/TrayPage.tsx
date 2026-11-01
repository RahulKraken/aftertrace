import { useEffect, useState } from "react"
import { ChevronRight, Settings } from "lucide-react"
import { Link } from "wouter"
import { api } from "../lib/api"
import { clock, remain, sayTok, usd } from "../lib/format"
import { mondayReset, readBudget } from "../lib/budget"
import { modelFamily, primaryModel, usageWindow } from "../lib/model"
import { monthlyUSD, shortTitle } from "../lib/welcome"
import type { Overview, Session } from "../lib/types"
import { Logo } from "../components/Logo"
import { Meter } from "../components/Meter"
import { ModelChip } from "../components/ModelChip"
import { Money } from "../components/Money"
import { StateChip } from "../components/StateChip"
import { TraceLine } from "../components/TraceLine"

export function TrayPage() {
  const [ov, setOv] = useState<Overview | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [budget, setBudget] = useState(() => readBudget()?.weekly ?? null)

  useEffect(() => {
    const on = () => setBudget(readBudget()?.weekly ?? null)
    window.addEventListener("aftertrace-budget", on)
    return () => window.removeEventListener("aftertrace-budget", on)
  }, [])

  useEffect(() => {
    let alive = true
    Promise.all([api.overview(), api.sessions()]).then(([o, ss]) => {
      if (!alive) return
      setOv(o)
      setSessions(ss)
    }).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  if (!ov) return <div className="v4-desk" />
  return <TrayPopover ov={ov} sessions={sessions} budget={budget} />
}

export function TrayPopover({
  ov,
  sessions,
  budget,
}: {
  ov: Overview
  sessions: Session[]
  budget: number | null
}) {
  const todayStart = new Date(ov.now / 1e6)
  todayStart.setHours(0, 0, 0, 0)
  const todayNs = todayStart.getTime() * 1e6
  const todaySessions = sessions.filter((s) => s.start_ns >= todayNs)
  const today = todaySessions.reduce((a, s) => a + (s.cost_usd || 0), 0) || todayFromDays(ov)
  const weekDays = ov.days.slice(-7)
  const max = Math.max(...weekDays.map((d) => d.cost_usd), 0.01)
  const live = ov.live[0]
  const liveSession = live ? sessions.find((s) => s.session_id === live.session_id) : undefined
  const win = usageWindow(ov.now, [...sessions.map((s) => s.start_ns), ...ov.live.map((l) => l.start_ns)])
  const top = ov.savings?.shown?.[0] || ov.top
  const weekSpend = ov.week.cost_usd
  const reset = mondayReset()

  return (
    <div className="v4-desk">
      <div className="v4-mb">
        <span className="v4-me">
          <Logo size={16} />
          {usd(today)}
        </span>
        <span>{new Date(ov.now / 1e6).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <div className="v4-pop">
        <div className="sec v4-td">
          <div>
            <div className="v4-lbl">Today</div>
            <div className="v4-num"><Money value={today} /></div>
          </div>
          <div className="v4-wb">
            {weekDays.map((d) => {
              const parts = d.by_model && d.by_model.length ? d.by_model : [{ model: "other", cost_usd: d.cost_usd }]
              const tot = parts.reduce((a, p) => a + p.cost_usd, 0) || 1
              return (
                <span className="v4-wbc" key={d.start_ns}>
                  {parts.map((p) => (
                    <i
                      key={p.model}
                      style={{
                        height: `${Math.max((p.cost_usd / tot) * (d.cost_usd / max) * 100, d.cost_usd > 0 ? 8 : 0)}%`,
                        background:
                          modelFamily(p.model) === "sonnet"
                            ? "var(--m-son)"
                            : modelFamily(p.model) === "opus"
                              ? "var(--m-opus)"
                              : "var(--bar)",
                      }}
                    />
                  ))}
                </span>
              )
            })}
          </div>
        </div>
        {(budget || win) && (
          <div className="sec v4-mt">
            {budget ? (
              <div className="v4-meter">
                <div className="v4-lbl">Budget</div>
                <Meter fill={weekSpend / budget} left={`${usd(weekSpend)} / ${usd(budget)}`} right={<b>{remain(reset.ms)}</b>} />
              </div>
            ) : (
              <div className="v4-meter">
                <div className="v4-lbl">This week</div>
                <div className="v4-rs" style={{ marginTop: 8 }}>
                  <span>{usd(weekSpend)}</span>
                  <span><b>{remain(reset.ms)}</b></span>
                </div>
              </div>
            )}
            {win && (
              <div className="v4-meter">
                <div className="v4-lbl">5h window</div>
                <Meter
                  fill={win.elapsed_ns / (5 * 3600e9)}
                  time
                  left={`→ ${clock(win.end_ns)}`}
                  right={<b>{remain(win.left_ns / 1e6)}</b>}
                />
              </div>
            )}
          </div>
        )}
        {live && (
          <div className="sec">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <StateChip running />
              {primaryModel(liveSession?.models) ? <ModelChip model={primaryModel(liveSession?.models)} /> : null}
              <span className="v4-when" style={{ marginLeft: "auto" }}>{clock(live.start_ns)} → {clock(live.last_ns)}</span>
            </div>
            <div style={{ font: "500 13.5px/18px var(--sans)", marginTop: 10 }}>{live.title || live.doing}</div>
            <div style={{ marginTop: 6, display: "flex", gap: 12 }}>
              {liveSession?.turns ? <span className="v4-tk"><b>{liveSession.turns}</b>×</span> : null}
              {liveSession?.tokens ? <span className="v4-tk"><b>{sayTok(liveSession.tokens)}</b> tok</span> : null}
              <span className="v4-tk"><b>{usd(live.cost_usd)}</b></span>
            </div>
            <TraceLine values={[live.cost_usd || 0.1]} width={322} height={44} live sw={1.3} r={3} tail={0.3} />
          </div>
        )}
        {top && (
          <Link href={`/findings?focus=${top.id}`} className="sec" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 }}>
            <span className="v4-dot" style={{ background: "var(--amber)" }} />
            <span style={{ flex: 1 }}>{shortTitle(top)}</span>
            <span style={{ color: "var(--amber-ink)", fontWeight: 500 }}>{usd(typeof top.monthly_usd === "number" ? top.monthly_usd : monthlyUSD(top))}/mo</span>
            <ChevronRight size={14} />
          </Link>
        )}
        <div className="v4-ft">
          <Link href="/">Open Aftertrace<kbd>⌘O</kbd></Link>
          <Link href="/settings" className="v4-dim"><Settings size={16} /></Link>
        </div>
      </div>
    </div>
  )
}

function todayFromDays(ov: Overview): number {
  const last = ov.days[ov.days.length - 1]
  return last?.cost_usd || 0
}
