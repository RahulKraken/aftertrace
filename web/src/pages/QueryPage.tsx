import { useEffect, useRef, useState } from "react"
import { useLocation } from "wouter"
import { api } from "../lib/api"
import { dur, tok, usd, when } from "../lib/format"
import type { AskResult, AskSuggestions, Field, QueryResult, QuerySpec, SqlResult, TraceHit } from "../lib/types"

const AGGS = ["COUNT", "SUM", "AVG", "MIN", "MAX", "P50", "P95", "P99"]
// The calm hue family, in the order series appear.
const PAL = ["#6359e0", "#e29a2e", "#14998e", "#9466d6", "#2b88b0"]

function opsFor(fields: Field[], key: string): string[] {
  const f = fields.find((x) => x.key === key)
  if (f?.kind === "num") return ["=", "!=", ">", "<", ">=", "<="]
  return ["=", "!=", "contains", "exists", "not exists"]
}

const defaultQ = (): QuerySpec => ({
  agg: "P95",
  field: "duration_ms",
  where: [{ field: "name", op: "=", value: "claude_code.llm_request" }],
  group_by: ["model"],
  order: "desc",
  limit: 20,
})

type Tab = "builder" | "ask" | "sql"

export function QueryPage() {
  const [tab, setTab] = useState<Tab>("builder")
  const [fields, setFields] = useState<Field[]>([])
  const [range, setRange] = useState<{ lo: number; hi: number } | null>(null)
  const [q, setQ] = useState<QuerySpec>(defaultQ)
  const [preset, setPreset] = useState("all")
  const [res, setRes] = useState<QueryResult | null>(null)
  const [lastQ, setLastQ] = useState<QuerySpec | null>(null)
  const [traces, setTraces] = useState<{ title: string; list: TraceHit[] } | null>(null)
  const [sugg, setSugg] = useState<AskSuggestions | null>(null)
  const [askQ, setAskQ] = useState("")
  const [ask, setAsk] = useState<AskResult | null>(null)
  const [sql, setSql] = useState(
    "SELECT model, count(*) AS requests, round(sum(cost_usd),2) AS cost_usd\nFROM llm GROUP BY model ORDER BY cost_usd DESC",
  )
  const [sqlres, setSqlres] = useState<SqlResult | null>(null)
  const [running, setRunning] = useState(false)
  const [asking, setAsking] = useState(false)
  const [askErr, setAskErr] = useState<string | null>(null)
  const [sqlRunning, setSqlRunning] = useState(false)
  const [histN, setHistN] = useState(0)
  const hist = useRef<QuerySpec[]>([])
  const [, nav] = useLocation()

  const pushQ = (prev: QuerySpec) => {
    hist.current.push(prev)
    setHistN(hist.current.length)
  }
  const undo = () => {
    const prev = hist.current.pop()
    if (!prev) return
    setHistN(hist.current.length)
    setQ(prev)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (tab !== "builder") return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [tab])

  useEffect(() => {
    Promise.all([api.fields(), api.range()]).then(([f, r]) => {
      setFields(f)
      setRange(r)
    })
  }, [])

  useEffect(() => {
    if (tab === "ask" && !sugg) api.askSuggestions().then(setSugg)
  }, [tab, sugg])

  const applyPreset = (spec: QuerySpec): QuerySpec => {
    if (!range || preset === "all") return spec
    const span = { "24h": 864e11, "3d": 2592e11, "7d": 6048e11 }[preset]
    if (!span) return spec
    return { ...spec, from_ns: range.hi - span, to_ns: range.hi + 1 }
  }

  const run = async (spec = q) => {
    const full = applyPreset(spec)
    setTraces(null)
    setRunning(true)
    try {
      const r = await api.query(full)
      setRes(r)
      setLastQ(full)
    } finally {
      setRunning(false)
    }
  }

  const showTraces = async (groups: (string | null)[], bucket?: [number, number]) => {
    if (!lastQ) return
    const list = await api.traces(lastQ, groups, bucket)
    const g = (lastQ.group_by || []).map((name, i) => `${name} = ${groups[i] ?? "(none)"}`).join(", ") || "all"
    setTraces({
      title: `${list.length} traces where ${g}${bucket ? ", in the selected bucket" : ""}`,
      list,
    })
  }

  const askIt = async (question: string) => {
    if (!question.trim()) return
    setAskQ(question)
    setAsking(true)
    setAskErr(null)
    try {
      const r = await api.ask(question)
      setAsk(r)
    } catch (e) {
      setAsk(null)
      setAskErr((e as Error).message)
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="page">
      <h1>Query</h1>
      <div className="sub">Build a query, ask a question, or write SQL. Every result opens the traces behind it.</div>
      <div className="seg" style={{ marginTop: 14 }}>
        {(["builder", "ask", "sql"] as Tab[]).map((t) => (
          <button type="button" key={t} className={tab === t ? "on" : undefined} onClick={() => setTab(t)}>
            {t === "builder" ? "Builder" : t === "ask" ? "Ask" : "SQL"}
          </button>
        ))}
      </div>

      {tab === "builder" && (
        <>
          <div className="qb">
            <div className="qrow">
              <span className="qk">VISUALIZE</span>
              <span className="clause">
                <select value={q.agg} onChange={(e) => setQ({ ...q, agg: e.target.value })}>
                  {AGGS.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
                {q.agg !== "COUNT" && (
                  <FieldSelect fields={fields} numeric value={q.field} onChange={(v) => setQ({ ...q, field: v })} />
                )}
              </span>
            </div>
            <div className="qrow">
              <span className="qk">WHERE</span>
              {q.where.map((w, i) => (
                <span className="clause" key={i}>
                  <FieldSelect
                    fields={fields}
                    value={w.field}
                    onChange={(v) => {
                      pushQ(q)
                      const ops = opsFor(fields, v)
                      const where = q.where.slice()
                      where[i] = { ...w, field: v, op: ops.includes(w.op) ? w.op : ops[0] }
                      setQ({ ...q, where })
                    }}
                  />
                  <select
                    value={w.op}
                    onChange={(e) => {
                      pushQ(q)
                      const where = q.where.slice()
                      where[i] = { ...w, op: e.target.value }
                      setQ({ ...q, where })
                    }}
                  >
                    {opsFor(fields, w.field).map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                  {!w.op.includes("exists") && (
                    <ValueInput
                      field={w.field}
                      value={w.value || ""}
                      onChange={(v) => {
                        pushQ(q)
                        const where = q.where.slice()
                        where[i] = { ...w, value: v }
                        setQ({ ...q, where })
                      }}
                    />
                  )}
                  <span
                    className="x"
                    onClick={() => {
                      pushQ(q)
                      setQ({ ...q, where: q.where.filter((_, j) => j !== i) })
                    }}
                  >
                    ×
                  </span>
                </span>
              ))}
              <span
                className="add"
                onClick={() => {
                  pushQ(q)
                  setQ({ ...q, where: [...q.where, { field: "name", op: "=", value: "" }] })
                }}
              >
                + filter
              </span>
            </div>
            <div className="qrow">
              <span className="qk">GROUP BY</span>
              {q.group_by.map((g, i) => (
                <span className="clause" key={i}>
                  <FieldSelect
                    fields={fields}
                    value={g}
                    onChange={(v) => {
                      pushQ(q)
                      const group_by = q.group_by.slice()
                      group_by[i] = v
                      setQ({ ...q, group_by })
                    }}
                  />
                  <span
                    className="x"
                    onClick={() => {
                      pushQ(q)
                      setQ({ ...q, group_by: q.group_by.filter((_, j) => j !== i) })
                    }}
                  >
                    ×
                  </span>
                </span>
              ))}
              {q.group_by.length < 2 && (
                <span
                  className="add"
                  onClick={() => {
                    pushQ(q)
                    setQ({ ...q, group_by: [...q.group_by, "skill.name"] })
                  }}
                >
                  + group
                </span>
              )}
            </div>
            <div className="qrow">
              <span className="qk">ORDER BY</span>
              <span className="clause">
                <select value={q.order} onChange={(e) => setQ({ ...q, order: e.target.value as "asc" | "desc" })}>
                  <option value="desc">desc</option>
                  <option value="asc">asc</option>
                </select>
              </span>
              <span className="qk" style={{ width: "auto", marginLeft: 12 }}>
                LIMIT
              </span>
              <span className="clause">
                <input
                  value={q.limit}
                  size={3}
                  onChange={(e) => setQ({ ...q, limit: Number(e.target.value) || 20 })}
                />
              </span>
              <span className="qk" style={{ width: "auto", marginLeft: 12 }}>
                TIME
              </span>
              <span className="clause">
                <select value={preset} onChange={(e) => setPreset(e.target.value)}>
                  <option value="all">all data</option>
                  <option value="24h">last 24h of data</option>
                  <option value="3d">last 3 days</option>
                  <option value="7d">last 7 days</option>
                </select>
              </span>
              <span className="spacer" />
              <button className="btn ghost" disabled={!histN} onClick={undo} title="⌘Z">
                Undo filter
              </button>
              <button className="btn" disabled={running} onClick={() => run()}>
                {running ? "Running…" : "Run query"}
              </button>
            </div>
          </div>
          {res && lastQ && (
            <Results
              res={res}
              spec={lastQ}
              traces={traces}
              onPoint={showTraces}
              onTrace={(t) => nav(`/trace/${t.trace_id}?span=${t.span_id}`)}
            />
          )}
        </>
      )}

      {tab === "ask" && (
        <>
          <div className="ask">
            <input
              className="txt"
              value={askQ}
              placeholder="Ask about your sessions, e.g. which skill costs the most per activation?"
              onChange={(e) => setAskQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && askIt(askQ)}
            />
            <button className="btn" disabled={asking} onClick={() => askIt(askQ)}>
              {asking ? "Asking…" : "Ask"}
            </button>
          </div>
          <div className="qchips">
            {(sugg?.questions || []).map((question) => (
              <button type="button" key={question} onClick={() => askIt(question)}>
                {question}
              </button>
            ))}
          </div>
          <div className={`priv${sugg?.enabled === false ? " is-off" : ""}`}>
            {sugg?.enabled === false ? (
              <>
                Ask is off. Run <code>aftertrace serve --ask</code> with <code>ANTHROPIC_API_KEY</code> set. It sends the
                schema and query results (long strings cut) to the Anthropic API; nothing else leaves this machine.
              </>
            ) : (
              <>Agent: {sugg?.agent || "…"}</>
            )}
          </div>
          {asking && <div className="ask-wait">Writing and running queries…</div>}
          {askErr && (
            <div className="err-box">
              {askErr}
              <div className="err-next">Ask again, or switch to SQL and write the query yourself.</div>
            </div>
          )}
          {ask && (
            <div className="qres" style={{ gridTemplateColumns: "1fr 360px" }}>
              <div className="card">
                <div className="answer">{ask.answer}</div>
                {ask.steps && ask.steps.length > 0 && (
                  <details className="ask-steps">
                    <summary>
                      Ran {ask.steps.length} {ask.steps.length === 1 ? "query" : "queries"}
                      {ask.model ? ` · ${ask.model}` : ""}
                    </summary>
                    {ask.steps.map((st, i) => (
                      <div key={i} className="ask-step">
                        <pre>{st.sql}</pre>
                        <span className={st.error ? "err-text" : "mute"}>{st.error || `${st.rows} rows`}</span>
                      </div>
                    ))}
                  </details>
                )}
                {ask.sql && (
                  <>
                    <details open>
                      <summary>Query it ran</summary>
                      <pre>{ask.sql}</pre>
                    </details>
                    <div style={{ display: "flex", gap: 8, margin: "8px 0" }}>
                      <button
                        className="btn ghost"
                        onClick={() => {
                          setSql(ask.sql || "")
                          setSqlres(null)
                          setTab("sql")
                        }}
                      >
                        Edit as SQL
                      </button>
                      {ask.builder && (
                        <button
                          className="btn ghost"
                          onClick={() => {
                            setQ({ ...defaultQ(), ...ask.builder })
                            setTab("builder")
                            run({ ...defaultQ(), ...ask.builder })
                          }}
                        >
                          Open in builder
                        </button>
                      )}
                    </div>
                    {ask.result && <SqlTable res={ask.result} compact onTrace={(id) => nav(`/trace/${id}`)} />}
                  </>
                )}
              </div>
              <div className="card">
                <div className="sub" style={{ marginBottom: 6 }}>
                  Evidence traces
                </div>
                <div className="trlist">
                  {ask.evidence.length ? (
                    ask.evidence.map((e, i) => (
                      <div
                        className="tr"
                        key={i}
                        onClick={() => nav(`/trace/${e.trace_id}?span=${e.span_id}`)}
                      >
                        <span>{String(e.label ?? "")}</span>
                        <span className="mute mono">{String(e.trace_id).slice(0, 8)} ›</span>
                      </div>
                    ))
                  ) : (
                    <div className="empty">None.</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "sql" && (
        <>
          <div className="card" style={{ marginTop: 14 }}>
            <div className="sql-banner">
              Read-only. One SELECT or WITH. This tab cannot write, insert, or delete. Columns named{" "}
              <code>trace_id</code> open the waterfall.
            </div>
            <textarea className="sqlbox" spellCheck={false} value={sql} onChange={(e) => setSql(e.target.value)} />
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
              <button
                className="btn"
                disabled={sqlRunning}
                onClick={async () => {
                  setSqlRunning(true)
                  try {
                    setSqlres(await api.sql(sql))
                  } finally {
                    setSqlRunning(false)
                  }
                }}
              >
                {sqlRunning ? "Running…" : "Run"}
              </button>
            </div>
          </div>
          {sqlres && <SqlTable res={sqlres} onTrace={(id) => nav(`/trace/${id}`)} />}
        </>
      )}
    </div>
  )
}

function FieldSelect({
  fields,
  value,
  onChange,
  numeric,
}: {
  fields: Field[]
  value: string
  onChange: (v: string) => void
  numeric?: boolean
}) {
  const fs = numeric ? fields.filter((f) => f.kind === "num") : fields
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {fs.map((f) => (
        <option key={f.key}>{f.key}</option>
      ))}
    </select>
  )
}

function ValueInput({
  field,
  value,
  onChange,
}: {
  field: string
  value: string
  onChange: (v: string) => void
}) {
  const [opts, setOpts] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    api.fieldValues(field).then(setOpts).catch(() => setOpts([]))
  }, [field])
  const shown = opts.filter((o) => !value || o.toLowerCase().includes(value.toLowerCase())).slice(0, 8)
  return (
    <span className="val-wrap">
      <input
        value={value}
        size={18}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 140)}
        placeholder="value"
        autoComplete="off"
      />
      {open && shown.length > 0 && (
        <span className="val-sugg">
          {shown.map((o) => (
            <button
              type="button"
              key={o}
              onMouseDown={(e) => {
                e.preventDefault()
                onChange(o)
                setOpen(false)
              }}
            >
              {o}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

function Results({
  res,
  spec,
  traces,
  onPoint,
  onTrace,
}: {
  res: QueryResult
  spec: QuerySpec
  traces: { title: string; list: TraceHit[] } | null
  onPoint: (groups: (string | null)[], bucket?: [number, number]) => void
  onTrace: (t: TraceHit) => void
}) {
  if (res.error) {
    return (
      <div className="card" style={{ marginTop: 12, color: "var(--hue-retry)" }}>
        {res.error}
        <div className="err-next">Adjust the clause and run again, or switch to Ask for a suggested query.</div>
      </div>
    )
  }
  const fmtV = (v: number) =>
    spec.field === "cost_usd" && spec.agg !== "COUNT" ? usd(v) : spec.agg === "COUNT" ? String(Math.round(v)) : spec.field.endsWith("_ms") ? dur(v) : tok(v)

  return (
    <div className={`qres ${traces ? "" : "one"}`}>
      <div>
        <div className="card">
          <Chart res={res} fmtV={fmtV} onPoint={onPoint} />
        </div>
        <table className="grid">
          <thead>
            <tr>
              {(spec.group_by || []).map((g) => (
                <th key={g}>{g}</th>
              ))}
              <th className="r">
                {spec.agg}
                {spec.agg === "COUNT" ? "" : `(${spec.field})`}
              </th>
              <th className="r">spans</th>
            </tr>
          </thead>
          <tbody>
            {res.table.map((row, i) => (
              <tr key={i} onClick={() => onPoint(row.groups)}>
                {row.groups.map((g, j) => (
                  <td key={j}>{g == null ? <span className="mute">(none)</span> : g}</td>
                ))}
                <td className="num r">{row.value == null ? "" : fmtV(row.value)}</td>
                <td className="num r">{row.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <details style={{ marginTop: 10 }}>
          <summary>SQL</summary>
          <pre>
            {res.sql}
            {"\n"}-- params: {JSON.stringify(res.params)}
          </pre>
        </details>
      </div>
      {traces && (
        <div>
          <div className="card">
            <div className="sub" style={{ marginBottom: 6 }}>
              {traces.title}
            </div>
            <div className="trlist">
              {traces.list.length ? (
                traces.list.map((t) => {
                  const w = when(t.start_ns)
                  return (
                    <div className="tr" key={t.trace_id} onClick={() => onTrace(t)}>
                      <span>
                        <span className="num">
                          <span className="date">{w.date}</span>
                          {w.time}
                        </span>{" "}
                        <span className="mute">{t.repo || ""}</span>
                      </span>
                      <span className="num">
                        {t.matches} span{t.matches > 1 ? "s" : ""} · max {dur(t.max_ms)}
                      </span>
                    </div>
                  )
                })
              ) : (
                <div className="empty">No traces.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Chart({
  res,
  fmtV,
  onPoint,
}: {
  res: QueryResult
  fmtV: (v: number) => string
  onPoint: (groups: (string | null)[], bucket?: [number, number]) => void
}) {
  const W = 760
  const H = 220
  const P = 44
  const all = res.series.flatMap((s) => s.points)
  const maxV = Math.max(1e-9, ...all.map((p) => p[1] || 0))
  const lo = res.lo || 0
  const hi = res.hi || 1
  const xs = (t: number) => P + ((t - lo) / Math.max(1, hi - lo)) * (W - P - 8)
  const ys = (v: number) => H - 22 - (v / maxV) * (H - 36)
  const days: number[] = []
  for (let t = lo; t <= hi; t += 864e11) days.push(t)
  const path = (pts: [number, number | null][]) =>
    pts.map((p, i) => `${i ? "L" : "M"}${xs(p[0]).toFixed(1)},${ys(p[1] || 0).toFixed(1)}`).join(" ")

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={P} x2={W - 8} y1={ys(maxV * f)} y2={ys(maxV * f)} stroke="var(--line)" />
            <text x={P - 6} y={ys(maxV * f) + 3} textAnchor="end" fontSize="10" fill="var(--faint)" fontFamily="var(--mono)">
              {fmtV(maxV * f)}
            </text>
          </g>
        ))}
        {days
          .filter((t) => xs(t) < W - 40)
          .map((t) => (
            <text key={t} x={xs(t)} y={H - 6} fontSize="10" fill="var(--faint)" fontFamily="var(--mono)">
              {new Date(t / 1e6).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
            </text>
          ))}
        {res.series.map((s, i) => (
          <g key={i}>
            <path d={path(s.points)} className="q-line" style={{ ["--i" as string]: i }} pathLength={1} fill="none" stroke={PAL[i % PAL.length]} strokeWidth="1.75" />
            {s.points.map((p, j) => (
              <circle
                key={j}
                className="pt"
                cx={xs(p[0])}
                cy={ys(p[1] || 0)}
                r="3.5"
                fill="var(--surface-2)"
                stroke={PAL[i % PAL.length]}
                strokeWidth="1.5"
                style={{ cursor: "pointer" }}
                onClick={() => onPoint(s.groups, [p[0], p[0] + res.step_ns])}
              >
                <title>
                  {s.groups.join(" · ") || "all"}: {fmtV(p[1] || 0)}
                </title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      <div className="legend">
        {res.series.map((s, i) => (
          <span key={i}>
            <i style={{ background: PAL[i % PAL.length] }} />
            {s.groups.join(" · ") || "all"}
          </span>
        ))}
      </div>
    </>
  )
}

function SqlTable({
  res,
  compact,
  onTrace,
}: {
  res: SqlResult
  compact?: boolean
  onTrace: (id: string) => void
}) {
  const ti = res.columns.indexOf("trace_id")
  const fmt = (v: unknown) => {
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(3)
    if (v == null) return ""
    const s = String(v)
    return s.length > 48 ? `${s.slice(0, 8)}…` : s
  }
  if (res.error) {
    return (
      <div className="card" style={{ marginTop: 12, color: "var(--hue-retry)" }}>
        {res.error}
        <div className="err-next">Fix the statement and run again. Only a single SELECT or WITH is allowed.</div>
      </div>
    )
  }
  return (
    <table className="grid" style={compact ? { marginTop: 4 } : undefined}>
      <thead>
        <tr>
          {res.columns.map((c) => (
            <th key={c}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {res.rows.map((r, i) => (
          <tr
            key={i}
            onClick={ti >= 0 ? () => onTrace(String(r[ti])) : undefined}
            style={ti < 0 ? { cursor: "default" } : undefined}
          >
            {r.map((v, j) => (
              <td key={j} className={typeof v === "number" ? "num" : undefined}>
                {fmt(v)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
