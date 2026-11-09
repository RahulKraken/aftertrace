import { useEffect, useMemo, useState } from "react"
import { ChevronRight } from "lucide-react"
import { Link, useLocation } from "wouter"
import { api } from "../lib/api"
import { readCached, startPoll, writeCached } from "../lib/poll"
import { clock, hm, sayTok, usd, when } from "../lib/format"
import { modelFamily, primaryModel } from "../lib/model"
import { shortTitle } from "../lib/welcome"
import type { Finding, Session, SessionDetail } from "../lib/types"
import { ModelChip } from "../components/ModelChip"
import { Money } from "../components/Money"
import { StateChip } from "../components/StateChip"
import { TraceLine } from "../components/TraceLine"

export function SessionsPage() {
  const [rows, setRows] = useState<Session[] | null>(() => readCached<Session[]>("aftertrace.sessions"))
  const [err, setErr] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, SessionDetail>>({})
  const [findings, setFindings] = useState<Finding[]>([])
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

  useEffect(() => {
    if (!rows?.length) return
    const first = rows.find((s) => s.running) || rows[0]
    setSel((cur) => cur || first.session_id)
  }, [rows])

  useEffect(() => {
    if (!rows) return
    const need = rows.slice(0, 24).filter((s) => !details[s.session_id])
    if (!need.length) return
    let alive = true
    Promise.all(need.map((s) => api.session(s.session_id).then((d) => [s.session_id, d] as const))).then((pairs) => {
      if (!alive) return
      setDetails((cur) => {
        const next = { ...cur }
        for (const [id, d] of pairs) next[id] = d
        return next
      })
    }).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [rows, details])

  const groups = useMemo(() => {
    const out: { day: string; cost: number; rows: Session[] }[] = []
    for (const s of rows || []) {
      const d = dayLabel(s.start_ns)
      if (!out.length || out[out.length - 1].day !== d) out.push({ day: d, cost: 0, rows: [] })
      const g = out[out.length - 1]
      g.rows.push(s)
      g.cost += s.cost_usd || 0
    }
    return out
  }, [rows])

  if (err) {
    return (
      <div className="page">
        {err}
        <div className="err-next">Reload this page. If it persists, check that aftertrace serve is running.</div>
      </div>
    )
  }
  if (!rows) return <div className="v4"><div className="v4-empty">Loading…</div></div>

  const stats = {
    sessions: rows.length,
    time: rows.reduce((a, s) => a + (s.turn_ms || 0), 0),
    spend: rows.reduce((a, s) => a + (s.cost_usd || 0), 0),
    tokens: rows.reduce((a, s) => a + (s.tokens || 0), 0),
  }
  const families = new Set(rows.flatMap((s) => (s.models || []).map(modelFamily)).filter((f) => f !== "other"))
  const selected = rows.find((s) => s.session_id === sel) || rows[0]
  const detail = selected ? details[selected.session_id] : undefined

  if (!rows.length) {
    return (
      <div className="v4">
        <div className="v4-ph"><h1>Sessions</h1></div>
        <section className="v4-card v4-empty">No sessions yet.</section>
      </div>
    )
  }

  return (
    <div className="v4 split sessions">
      <div className="v4-l">
        <div className="v4-ph">
          <h1>Sessions</h1>
        </div>
        <div className="v4-stats">
          <div><div className="v4-lbl">Sessions</div><div className="v4-num">{stats.sessions}</div></div>
          <div>
            <div className="v4-lbl">Time</div>
            <div className="v4-num">
              {hm(stats.time).h}<small>h</small>{hm(stats.time).m}<small>m</small>
            </div>
          </div>
          <div><div className="v4-lbl">Spend</div><div className="v4-num"><Money value={stats.spend} /></div></div>
          <div><div className="v4-lbl">Tokens</div><div className="v4-num mono">{sayTok(stats.tokens)}</div></div>
          <div className="lg2">
            {families.has("opus") && <ModelChip model="opus" />}
            {families.has("sonnet") && <ModelChip model="sonnet" />}
            {families.has("haiku") && <ModelChip model="haiku" />}
          </div>
        </div>
        <section className="v4-card v4-runs">
          {groups.map((g) => (
            <div key={g.day}>
              <div className="v4-dh"><span>{g.day}</span><span>{usd(g.cost)}</span></div>
              {g.rows.map((s) => {
                const fam = modelFamily(primaryModel(s.models))
                const turns = details[s.session_id]?.turns || []
                const vals = turns.map((t) => t.cost_usd || t.duration_ms || 0)
                return (
                  <button
                    type="button"
                    key={s.session_id}
                    className={`v4-rr${sel === s.session_id ? " sel" : ""}`}
                    onClick={() => setSel(s.session_id)}
                    onDoubleClick={() => nav(`/session/${s.session_id}`)}
                  >
                    <span className={`v4-mq ${fam}`} />
                    <span className="w2">
                      {s.running ? <StateChip running /> : <span className="v4-id">{s.session_id.replace(/-/g, "").slice(0, 7)}</span>}
                    </span>
                    <span className="v4-when">{clock(s.start_ns)}</span>
                    <TraceLine values={vals.length ? vals : [s.cost_usd || 0.05]} width={220} height={20} live={s.running} flag={s.findings > 0} sw={1.1} r={2.5} tail={0.74} />
                    <span className="c">{s.turns}×</span>
                    <span className="c">{sayTok(s.tokens)}</span>
                    <span className="c">{durShort(s.turn_ms)}</span>
                    <span className="v num">{usd(s.cost_usd)}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </section>
      </div>
      <SessionPane session={selected} detail={detail} findings={findings} />
    </div>
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
      <aside className="v4-pane">
        <div className="v4-empty">Pick a run.</div>
      </aside>
    )
  }
  const turns = detail?.turns || []
  const vals = turns.map((t) => t.cost_usd || t.duration_ms || 0)
  const peak = vals.length ? Math.max(...vals) : 0
  const t = when(session.start_ns)
  const linked = findings.filter((f) => f.sessions?.includes(session.session_id)).slice(0, 1)
  const end = session.end_ns || (turns.length ? turns[turns.length - 1].start_ns + (turns[turns.length - 1].duration_ms || 0) * 1e6 : session.start_ns)
  return (
    <aside className="v4-pane">
      <div className="v4-ph">
        <span className="v4-when">{t.date} · {t.time} · {session.session_id.replace(/-/g, "").slice(0, 7)}</span>
        {session.findings > 0 ? <span className="v4-dot" style={{ background: "var(--amber)" }} /> : null}
      </div>
      <h2>
        <Link href={`/session/${session.session_id}`}>{session.title || `Session ${session.session_id.slice(0, 8)}`}</Link>
      </h2>
      <div className="chips">
        <StateChip running={session.running} />
        {primaryModel(session.models) ? <ModelChip model={primaryModel(session.models)} /> : null}
      </div>
      <div className="v4-kp">
        <div><div className="v4-num"><Money value={session.cost_usd} /></div></div>
        <div>
          <div className="v4-num">
            {hm(session.turn_ms).h}<small>h</small>{hm(session.turn_ms).m}<small>m</small>
          </div>
        </div>
        <div><div className="v4-num">{session.turns}<small>×</small></div></div>
        <div><div className="v4-num mono">{sayTok(session.tokens)}</div></div>
      </div>
      <div className="v4-big-tr">
        <TraceLine
          values={vals.length ? vals : [session.cost_usd || 0.05]}
          width={344}
          height={190}
          live={session.running}
          flag={session.findings > 0}
          peak={peak > 0 ? usd(peak) : undefined}
          sw={1.4}
          r={3.5}
          tail={0.12}
        />
        <div className="v4-ticks">
          {(vals.length ? vals : [1]).map((v, i) => (
            <i key={i} className={v === peak && peak > 0 ? "peak" : ""} style={{ height: `${Math.max(12, (v / (peak || 1)) * 100)}%` }} />
          ))}
        </div>
        <div className="ax">
          <span>{clock(session.start_ns)}</span>
          <span>{clock(end)}</span>
        </div>
      </div>
      {linked.map((f) => (
        <Link key={f.id} href={`/findings?focus=${f.id}`} className="v4-lk">
          <span className="v4-dot" style={{ background: "var(--amber)" }} />
          <span className="nm">{shortTitle(f)}</span>
          <ChevronRight size={14} />
        </Link>
      ))}
    </aside>
  )
}

function dayLabel(ns: number): string {
  const d = new Date(ns / 1e6)
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })
}

function durShort(ms: number): string {
  const { h, m } = hm(ms)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
