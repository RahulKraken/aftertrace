import { useEffect, useMemo, useState } from "react"
import { Link, useLocation } from "wouter"
import { api, emptyMode } from "../lib/api"
import { readCached, startPoll, writeCached } from "../lib/poll"
import { previewSkeleton } from "../lib/cache"
import { SessionsSkeleton } from "../components/PageSkeleton"
import { EmptyState } from "../components/EmptyState"
import { Ribbon, RibbonKey } from "../components/Ribbon"
import { SearchField, Segmented, Toolbar } from "../lib/chrome"
import { useShell } from "../components/Shell"
import { dur, modelName, pct, tok, usd, when } from "../lib/format"
import { fromBreakdown } from "../lib/ribbon"
import type { Finding, Session, SessionDetail } from "../lib/types"

type Range = "week" | "month" | "all"

export function SessionsPage() {
  const { openCommand } = useShell()
  const [rows, setRows] = useState<Session[] | null>(() => readCached<Session[]>("aftertrace.sessions"))
  const [err, setErr] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [focus, setFocus] = useState(true)
  const [details, setDetails] = useState<Record<string, SessionDetail>>({})
  const [findings, setFindings] = useState<Finding[]>([])
  const [range, setRange] = useState<Range>("week")
  const [, nav] = useLocation()

  useEffect(() => {
    api.findings().then(setFindings).catch(() => undefined)
  }, [])

  const running = Boolean(rows?.some((r) => r.running))
  useEffect(() => {
    return startPoll(
      async () => {
        try {
          const next = await api.sessions()
          setRows(next)
          writeCached("aftertrace.sessions", next)
          setErr(null)
        } catch (e) {
          if (!rows) setErr((e as Error).message)
        }
      },
      { visibleMs: running ? 5000 : 30000, hiddenMs: 60000 },
    )
  }, [running])

  const filtered = useMemo(() => {
    const all = rows || []
    if (range === "all") return all
    const newest = all.reduce((m, s) => Math.max(m, s.start_ns), 0)
    const wall = Date.now() * 1e6
    // Frozen demo fixtures sit weeks behind wall clock; keep their week intact.
    const origin = newest > 0 && newest < wall - 7 * 86400e9 ? newest : Math.max(newest, wall)
    const span = range === "week" ? 7 : 30
    const lo = origin - span * 86400e9
    return all.filter((s) => s.running || s.start_ns >= lo)
  }, [rows, range])

  useEffect(() => {
    if (!filtered.length) return
    const first = filtered.find((s) => s.running) || filtered[0]
    setSel((cur) => (cur && filtered.some((s) => s.session_id === cur) ? cur : first.session_id))
  }, [filtered])

  useEffect(() => {
    if (!filtered.length) return
    const need = filtered.slice(0, 24).filter((s) => !details[s.session_id])
    if (!need.length) return
    let alive = true
    Promise.all(need.map((s) => api.session(s.session_id).then((d) => [s.session_id, d] as const)))
      .then((pairs) => {
        if (!alive) return
        setDetails((cur) => {
          const next = { ...cur }
          for (const [id, d] of pairs) next[id] = d
          return next
        })
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [filtered, details])

  const groups = useMemo(() => groupSessions(filtered), [filtered])
  const maxMs = Math.max(...filtered.map((s) => s.turn_ms || 0), 1)
  const weekSpend = filtered.reduce((a, s) => a + (s.cost_usd || 0), 0)

  if (err && !rows) {
    return (
      <>
        <Toolbar title="Sessions" />
        <EmptyState line="Aftertrace can't reach its engine. Restart it?" action="Reload" onClick={() => window.location.reload()} />
      </>
    )
  }
  if (previewSkeleton() || !rows) return <SessionsSkeleton />
  if (emptyMode() || !rows.length) {
    return (
      <>
        <Toolbar title="Sessions">
          <SearchField onClick={openCommand} />
        </Toolbar>
        <EmptyState line="Your next Claude Code session shows up here as it runs." action="Turn on live tracing" href="/settings?tab=sources" />
      </>
    )
  }

  const selected = filtered.find((s) => s.session_id === sel) || filtered[0]
  const detail = selected ? details[selected.session_id] : undefined

  return (
    <>
      <Toolbar title="Sessions" sub={`${filtered.length} this week · ${usd(weekSpend)}`}>
        <Segmented
          ariaLabel="Range"
          value={range}
          options={[
            { id: "week", label: "Week" },
            { id: "month", label: "Month" },
            { id: "all", label: "All" },
          ]}
          onChange={setRange}
        />
        <SearchField onClick={openCommand} />
      </Toolbar>
      <div className="body split s300">
        <div className="pad tblwrap" onFocus={() => setFocus(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocus(false) }}>
          <table className="tbl sess">
            <colgroup>
              <col style={{ width: 22 }} />
              <col />
              <col style={{ width: 100 }} />
              <col style={{ width: 72 }} />
              <col style={{ width: 62 }} />
              <col style={{ width: 64 }} />
            </colgroup>
            <thead>
              <tr>
                <th />
                <th>Session</th>
                <th>Where time went</th>
                <th className="r">Time</th>
                <th className="r">Tokens</th>
                <th className="r">Cost</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <GroupRows
                  key={g.day}
                  group={g}
                  sel={sel}
                  focus={focus}
                  maxMs={maxMs}
                  onSel={setSel}
                  onOpen={(id) => nav(`/session/${id}`)}
                />
              ))}
            </tbody>
          </table>
        </div>
        <SessionPane session={selected} detail={detail} findings={findings} />
      </div>
    </>
  )
}

function GroupRows({
  group,
  sel,
  focus,
  maxMs,
  onSel,
  onOpen,
}: {
  group: { day: string; cost: number; rows: Session[]; running?: boolean }
  sel: string | null
  focus: boolean
  maxMs: number
  onSel: (id: string) => void
  onOpen: (id: string) => void
}) {
  return (
    <>
      <tr className="day">
        <td colSpan={5}>{group.day}</td>
        <td className="r">{usd(group.cost)}</td>
      </tr>
      {group.rows.map((s) => {
        const on = sel === s.session_id
        return (
          <tr
            key={s.session_id}
            className={`${s.running ? "run " : ""}${on ? (focus ? "sel" : "sel-quiet") : ""}`}
            onClick={() => onSel(s.session_id)}
            onDoubleClick={() => onOpen(s.session_id)}
          >
            <td className="c-dot">{s.running ? <span className="dot live" /> : null}</td>
            <td className="c-title">
              <div className="title">{s.title || "Untitled session"}</div>
              <div className="meta">{s.repo || "—"}</div>
            </td>
            <td className="c-shape">
              <Ribbon parts={fromBreakdown(s.breakdown)} length={(s.turn_ms || 0) / maxMs} />
            </td>
            <td className="r l2">{dur(s.turn_ms)}</td>
            <td className="r l2">{tok(s.tokens)}</td>
            <td className="r">{usd(s.cost_usd)}</td>
          </tr>
        )
      })}
    </>
  )
}

function SessionPane({
  session,
  detail,
  findings,
}: {
  session?: Session
  detail?: SessionDetail
  findings: Finding[]
}) {
  if (!session) {
    return (
      <aside className="insp">
        <div className="l2">Pick a session.</div>
      </aside>
    )
  }
  const t = when(session.start_ns)
  const linked = findings.filter((f) => f.sessions?.includes(session.session_id)).slice(0, 4)
  const parts = fromBreakdown(session.breakdown)
  return (
    <aside className="insp">
      <h2>{session.title || "Untitled session"}</h2>
      <div className="l2">
        {[session.repo, modelName(session.models[0]), `${t.date}, ${t.time}`].filter(Boolean).join(" · ")}
      </div>
      <div className="kv">
        <div>
          <div className="v">{usd(session.cost_usd)}</div>
          <div className="k">cost</div>
        </div>
        <div>
          <div className="v">{dur(session.turn_ms)}</div>
          <div className="k">{session.turns} turn{session.turns === 1 ? "" : "s"}</div>
        </div>
        <div>
          <div className="v">{tok(session.tokens)}</div>
          <div className="k">tokens</div>
        </div>
        <div>
          <div className="v">{pct(session.cache_hit)}</div>
          <div className="k">cache hit</div>
        </div>
      </div>
      <Ribbon parts={parts} tall />
      <RibbonKey parts={parts} />
      {detail?.turns?.length ? (
        <>
          <div className="label" style={{ marginTop: 22 }}>
            Turns
          </div>
          <div className="list">
            {detail.turns.slice(0, 8).map((turn) => (
              <Link key={turn.trace_id} href={`/trace/${turn.trace_id}`} className="li">
                <div className="t">
                  <div>{turn.prompt || `Turn ${turn.seq}`}</div>
                </div>
                <span className="v l2 n">{usd(turn.cost_usd)}</span>
              </Link>
            ))}
          </div>
        </>
      ) : null}
      {linked.length > 0 && (
        <>
          <div className="label" style={{ marginTop: 22 }}>
            {linked.length} finding{linked.length === 1 ? "" : "s"}
          </div>
          <div className="list">
            {linked.map((f) => (
              <Link key={f.id} href={`/findings?focus=${f.id}`} className="li">
                <span className={`sw ${f.impact_unit.startsWith("USD") ? "money" : "t-wait"}`} />
                <div className="t">{f.headline}</div>
                <span className="v l2 n">{f.impact_unit.startsWith("USD") ? usd(f.impact_value) : dur(f.impact_value * 1000)}</span>
              </Link>
            ))}
          </div>
        </>
      )}
      <div style={{ marginTop: 18 }}>
        <Link href={`/session/${session.session_id}`} className="btn">
          Open session
        </Link>
      </div>
    </aside>
  )
}

function groupSessions(rows: Session[]) {
  const out: { day: string; cost: number; rows: Session[]; running?: boolean }[] = []
  const running = rows.filter((s) => s.running)
  const rest = rows.filter((s) => !s.running)
  if (running.length) {
    out.push({
      day: "Running",
      cost: running.reduce((a, s) => a + (s.cost_usd || 0), 0),
      rows: running,
      running: true,
    })
  }
  for (const s of rest) {
    const d = dayLabel(s.start_ns)
    if (!out.length || out[out.length - 1].day !== d) out.push({ day: d, cost: 0, rows: [] })
    const g = out[out.length - 1]
    g.rows.push(s)
    g.cost += s.cost_usd || 0
  }
  return out
}

function dayLabel(ns: number) {
  return new Date(ns / 1e6).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })
}
