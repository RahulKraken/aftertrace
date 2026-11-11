import { useEffect, useMemo, useState } from "react"
import { CaretRight, Pulse, TerminalWindow } from "@phosphor-icons/react"
import { Link, useLocation } from "wouter"
import { api, emptyMode } from "../lib/api"
import { readCached, startPoll, writeCached } from "../lib/poll"
import { previewSkeleton } from "../lib/cache"
import { HomeSkeleton } from "../components/PageSkeleton"
import { EmptyState } from "../components/EmptyState"
import { Ribbon, RibbonKey } from "../components/Ribbon"
import { SearchField, Toolbar } from "../lib/chrome"
import { useShell } from "../components/Shell"
import { clock, dur, modelName, pct, tok, usd } from "../lib/format"
import { hashParam } from "../lib/hash"
import { addParts, emptyParts, fromBreakdown, partsTotal } from "../lib/ribbon"
import { useStatus } from "../lib/status"
import { actionSentence, monthlyUSD, shortTitle } from "../lib/welcome"
import type { Finding, HistoryProject, LiveLane, Overview, Session, Status } from "../lib/types"

export function HomePage() {
  const { openCommand, openFindings } = useShell()
  const [ov, setOv] = useState<Overview | null>(() => readCached<Overview>("aftertrace.overview"))
  const [err, setErr] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const status = useStatus()
  const live = Boolean(ov?.live.length)

  useEffect(() => {
    let alive = true
    const load = () =>
      Promise.all([api.overview(), api.sessions()])
        .then(([o, ss]) => {
          if (!alive) return
          setOv(o)
          writeCached("aftertrace.overview", o)
          setSessions(ss)
          setErr(null)
        })
        .catch((e: Error) => {
          if (alive && !ov) setErr(e.message)
        })
    const stop = startPoll(load, { visibleMs: live ? 4000 : 30000, hiddenMs: 60000 })
    return () => {
      alive = false
      stop()
    }
  }, [live])

  const welcome = hashParam("welcome")
  const firstRun = welcome === "found" || welcome === "empty" || (status && !status.live_otel && !import.meta.env.VITE_USE_MOCK)

  if (err && !ov) {
    return (
      <>
        <Toolbar title="Today" />
        <EmptyState
          line="Aftertrace can't reach its engine. Restart it?"
          action="Reload"
          onClick={() => window.location.reload()}
        />
      </>
    )
  }
  if (previewSkeleton() || !ov) return <HomeSkeleton />

  if (welcome === "found" || (firstRun && status?.history?.found && welcome !== "empty")) {
    return <FirstRun status={status} />
  }
  if (welcome === "empty") {
    return (
      <>
        <Toolbar title="Today">
          <SearchField onClick={openCommand} />
        </Toolbar>
        <EmptyState
          line="No Claude Code sessions on this machine. Turn on live tracing and the first turn shows up here."
          action="Turn on live tracing"
          href="/settings?tab=sources"
        />
      </>
    )
  }
  if (emptyMode() || !ov.has_data) {
    return (
      <>
        <Toolbar title="Today">
          <SearchField onClick={openCommand} />
        </Toolbar>
        <EmptyState
          line="Spend and sessions show up after your first run."
          action="Turn on live tracing"
          href="/settings?tab=sources"
        />
      </>
    )
  }

  return <Today ov={ov} sessions={sessions} openCount={openFindings} />
}

function Today({ ov, sessions, openCount }: { ov: Overview; sessions: Session[]; openCount: number }) {
  const { openCommand } = useShell()
  const live = ov.live
  const weekSessions = sessions.filter((s) => s.start_ns >= ov.lo && s.start_ns < ov.hi)
  const weekParts = fromBreakdown(ov.week.breakdown)
  const maxDay = Math.max(...ov.days.filter((d) => d.turn_ms > 0).map((d) => d.turn_ms), 1)
  const days = [...ov.days].filter((d) => d.turns > 0 || d.cost_usd > 0).reverse()
  const dayParts = useMemo(() => {
    const map = new Map<number, ReturnType<typeof emptyParts>>()
    for (const s of weekSessions) {
      const day = new Date(s.start_ns / 1e6)
      day.setHours(0, 0, 0, 0)
      const key = day.getTime()
      map.set(key, addParts(map.get(key) || emptyParts(), s.breakdown))
    }
    return map
  }, [weekSessions])
  const repos = projects(weekSessions)
  const shownLive = live.slice(0, 3)
  const more = live.length - shownLive.length
  const last = sessions[0]
  const findings = ov.savings?.shown || (ov.top ? [ov.top] : [])
  const hero = findings[0]
  const rest = findings.slice(1, 4)

  return (
    <>
      <Toolbar title="Today">
        <SearchField onClick={openCommand} />
      </Toolbar>
      <div className="body today">
        <div className="pad col">
          <div className="sec-h">
            Running now
            <span className="m">{live.length ? `${live.length} session${live.length === 1 ? "" : "s"}` : ""}</span>
          </div>
          {live.length ? (
            shownLive.map((lane) => {
              const s = sessions.find((x) => x.session_id === lane.session_id)
              return <LiveLaneCard key={lane.session_id} lane={lane} session={s} />
            })
          ) : (
            <p className="l2" style={{ margin: "0 0 26px" }}>
              Nothing running.{last ? ` Your last session ended at ${clock(last.end_ns)}.` : ""}{" "}
              {last ? <Link href={`/session/${last.session_id}`} className="link">Open it</Link> : null}
            </p>
          )}
          {more > 0 ? (
            <Link href="/sessions" className="link" style={{ display: "inline-block", margin: "-12px 0 22px" }}>
              +{more} more
            </Link>
          ) : null}

          <div className="sec-h week-h">
            This week
            <span className="m">{weekRange(ov.lo, ov.hi)}</span>
          </div>
          <div className="hero">
            <div>
              <div className="big n">{usd(ov.week.cost_usd)}</div>
              <div className="cap">spent</div>
            </div>
            <div>
              <div className="big n">{dur(ov.week.turn_ms)}</div>
              <div className="cap">agent time</div>
            </div>
            <div>
              <div className="big n amb">{dur(ov.week.breakdown.permission_wait)}</div>
              <div className="cap">waiting on you</div>
            </div>
            <div className="facts">
              <div>
                <b className="n">{ov.week.sessions}</b> sessions
              </div>
              <div>
                <b className="n">{tok(ov.week.tokens)}</b> tokens
              </div>
              <div>
                <b className="n">{pct(ov.week.cache_hit)}</b> cache hit
              </div>
            </div>
          </div>
          <RibbonKey parts={weekParts} />
          <div className="days">
            {days.map((d) => {
              const start = new Date(d.start_ns / 1e6)
              start.setHours(0, 0, 0, 0)
              const parts = dayParts.get(start.getTime()) || emptyParts()
              const mix = partsTotal(parts) ? parts : fromBreakdown({
                model: Math.max(0, d.turn_ms - d.wait_ms),
                tool: 0,
                permission_wait: d.wait_ms,
                retry: 0,
                hook: 0,
                other: 0,
              })
              return (
                <div className="dayrow" key={d.day} title={dayTip(mix)}>
                  <span className="d">{dayName(d.start_ns)}</span>
                  <Ribbon parts={mix} length={d.turn_ms / maxDay} />
                  <span className="n l2">{dur(d.turn_ms)}</span>
                  <span className="n c">{usd(d.cost_usd)}</span>
                </div>
              )
            })}
          </div>
          {repos.length > 0 && (
            <>
              <div className="sec-h repo-h">By repo</div>
              <div className="repos">
                {repos.slice(0, 3).map((p) => (
                  <div key={p.name}>
                    <span className="l2">{p.name}</span>
                    <b className="n">{usd(p.cost_usd)}</b>
                    <span className="l3 n">{Math.round((p.cost_usd / Math.max(ov.week.cost_usd, 0.01)) * 100)}% of spend</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <aside className="insp col-r">
          <div className="sec-h">
            Worth changing
            <span className="m">{openCount || ov.open || findings.length}</span>
          </div>
          {hero ? (
            <div className="top-f">
              <div className="ft">{findingTitle(hero)}</div>
              <div className="fd l2">{hero.detail}</div>
              <div className="fsave">
                <span className="n">{usd(hero.monthly_usd ?? monthlyUSD(hero))}</span>a month
              </div>
              <div className="fact">
                <Link href={`/findings?focus=${hero.id}`} className="btn pri">
                  Show me
                </Link>
                <span className="l2 small">
                  {[shortDate(hero.last_ns || hero.first_ns), hero.project].filter(Boolean).join(" · ")}
                </span>
              </div>
            </div>
          ) : (
            <p className="l2">Nothing to change yet.</p>
          )}
          <div className="list">
            {rest.map((f) => (
              <Link key={f.id} href={`/findings?focus=${f.id}`} className="li">
                <span className={`sw ${swatch(f)}`} />
                <div className="t">{findingTitle(f)}</div>
                <span className={`v n ${f.impact_unit.startsWith("USD") ? "amb" : "l2"}`}>
                  {f.impact_unit.startsWith("USD") ? usd(f.monthly_usd ?? monthlyUSD(f)) : dur(f.impact_value * 1000)}
                </span>
                <CaretRight className="chev" />
              </Link>
            ))}
          </div>
          <div className="all">
            <Link href="/findings" className="link">
              All {openCount || ov.open || findings.length} findings
            </Link>
          </div>
        </aside>
      </div>
    </>
  )
}

function LiveLaneCard({ lane, session }: { lane: LiveLane; session?: Session }) {
  const doing = (lane.doing || "").replace(/^(Running|Using|Waiting)\s+/i, "")
  const elapsed = Date.now() - lane.start_ns / 1e6
  const parts = fromBreakdown(session?.breakdown)
  return (
    <Link href={`/session/${lane.session_id}`} className="lane">
      <div className="lane-top">
        <span className="dot live" />
        <span className="lt">{lane.title || session?.title || "Running"}</span>
        <span className="n lane-cost">{usd(session?.cost_usd ?? lane.cost_usd)}</span>
      </div>
      <div className="lane-doing">
        <TerminalWindow size={14} weight="regular" />
        <span className="mono">{doing || "working"}</span>
        <span className="l3">·</span>
        <span className="l2">
          {[session?.repo, modelName(session?.models?.[0]), dur(elapsed), session?.tokens != null ? `${tok(session.tokens)} tokens` : null]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      <Ribbon parts={parts} live tall />
    </Link>
  )
}

function FirstRun({ status }: { status: Status | null }) {
  const { openCommand } = useShell()
  const [, nav] = useLocation()
  if (!status) return <HomeSkeleton />
  const h = status.history
  const f = status.welcome_finding
  if (!h?.found) {
    return (
      <>
        <Toolbar title="Today">
          <SearchField onClick={openCommand} />
        </Toolbar>
        <EmptyState line="Nothing to change yet in this history. That's rare." action="Turn on live tracing" href="/settings?tab=sources" />
      </>
    )
  }
  const monthly = f ? monthlyUSD(f) || f.impact_value : 0
  return (
    <>
      <Toolbar title="Today">
        <SearchField onClick={openCommand} />
      </Toolbar>
      <div className="body">
        <div className="pad fr-wrap">
          <div className="fr-found l2">
            Aftertrace read <b className="n">{h.sessions}</b> Claude Code sessions from the last <b className="n">{h.days}</b> days on this Mac:{" "}
            <b className="n">{usd(h.cost_usd)}</b> and <b className="n">{tok(h.tokens)}</b> tokens.
          </div>
          {f ? (
            <div className="fr-card group">
              <div className="fr-t">{actionSentence(f)}</div>
              <div className="fr-save">
                <span className="big n amb">{usd(monthly)}</span>
                <span className="l2">a month, estimated from your session files</span>
              </div>
              <div className="fr-meta l2">{[f.project, spanLabel(f.first_ns, f.last_ns)].filter(Boolean).join(" · ")}</div>
              <div className="fact2">
                <button
                  type="button"
                  className="btn pri"
                  onClick={() => {
                    localStorage.setItem("aftertrace.welcome", "done")
                    nav(f.sessions[0] ? `/session/${f.sessions[0]}` : "/sessions")
                  }}
                >
                  Show me the sessions
                </button>
                <Link href="/findings" className="btn" onClick={() => localStorage.setItem("aftertrace.welcome", "done")}>
                  See all findings
                </Link>
              </div>
            </div>
          ) : (
            <div className="fr-card group">
              <div className="fr-t">Nothing to change yet in {h.sessions} sessions. That's rare.</div>
            </div>
          )}
          <div className="fr-live">
            <Pulse size={16} weight="regular" />
            <div>
              <div>Turn on live tracing to see waits, retries and slow hooks as they happen.</div>
              <div className="l2 small">
                Adds 7 lines to <span className="mono">~/.claude/settings.json</span>. You review them first.
              </div>
            </div>
            <Link href="/settings?tab=sources" className="btn">
              Turn on
            </Link>
          </div>
          <div className="label" style={{ marginTop: 24 }}>
            Where this came from
          </div>
          <div className="props">
            <div>
              <span className="l2">Read from</span>
              <span className="mono">{h.dir}</span>
              <span className="l2 n">
                {h.sessions} sessions · {h.days} days
              </span>
            </div>
            <div>
              <span className="l2">Kept in</span>
              <span>One file on this Mac</span>
              <span className="l2" />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function projects(rows: Session[]): HistoryProject[] {
  const m = new Map<string, HistoryProject>()
  for (const s of rows) {
    const name = s.repo || "unknown"
    const p = m.get(name) || { name, sessions: 0, cost_usd: 0, tokens: 0 }
    p.sessions++
    p.cost_usd += s.cost_usd || 0
    p.tokens += s.tokens || 0
    m.set(name, p)
  }
  return [...m.values()].sort((a, b) => b.cost_usd - a.cost_usd || a.name.localeCompare(b.name))
}

function weekRange(lo: number, hi: number) {
  const a = new Date(lo / 1e6)
  const b = new Date((hi - 1) / 1e6)
  const same = a.getMonth() === b.getMonth()
  const left = a.toLocaleDateString("en-GB", { day: "numeric", month: same ? undefined : "short" })
  const right = b.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
  return `${left} – ${right}`
}

function dayName(ns: number) {
  return new Date(ns / 1e6).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })
}

function shortDate(ns?: number) {
  if (!ns) return ""
  return new Date(ns / 1e6).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
}

function spanLabel(first?: number, last?: number) {
  if (!first) return ""
  const a = new Date(first / 1e6)
  const b = new Date((last || first) / 1e6)
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }
  const as = a.toLocaleDateString("en-GB", opts)
  const bs = b.toLocaleDateString("en-GB", opts)
  return as === bs ? as : `${as} – ${bs}`
}

function findingTitle(f: Finding) {
  return shortTitle(f)
}

function swatch(f: Finding) {
  if (f.impact_unit.startsWith("USD")) return "money"
  if (/wait/i.test(f.impact_unit) || f.rule_id.includes("permission")) return "t-wait"
  if (/retry/i.test(f.rule_id) || /retry/i.test(f.impact_unit)) return "t-retry"
  if (f.rule_id.includes("hook")) return "t-hook"
  return "t-other"
}

function dayTip(p: ReturnType<typeof emptyParts>) {
  return partsTotal(p)
    ? ["think", "tool", "wait", "retry", "hook", "other"]
        .map((k) => (p[k as keyof typeof p] ? `${k} ${dur(p[k as keyof typeof p])}` : ""))
        .filter(Boolean)
        .join(" · ")
    : ""
}
