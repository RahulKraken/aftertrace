import { useEffect, useState } from "react"
import { Link, useLocation, useParams } from "wouter"
import { ModelName } from "../components/SpanIcon"
import { api } from "../lib/api"
import { dur, impactParts, int, pct, tok, usd, when, modelName } from "../lib/format"
import type { AppDetail, AppGroup, Finding } from "../lib/types"

export function AppPage() {
  const params = useParams<{ service: string }>()
  const service = decodeURIComponent(params.service || "")
  const [d, setD] = useState<AppDetail | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [, nav] = useLocation()

  useEffect(() => {
    api
      .app(service)
      .then(setD)
      .catch((e: Error) => setErr(e.message))
    api
      .findings()
      .then(setFindings)
      .catch(() => undefined)
  }, [service])

  if (err) {
    return (
      <div className="page">
        {err}
        <div className="err-next">
          Go back to <Link href="/apps">Apps</Link>.
        </div>
      </div>
    )
  }
  if (!d) return <div className="page mute">Loading {service}…</div>
  const a = d.app
  const mine = findings.filter((f) => f.headline.startsWith(`${service} `) || f.headline.startsWith(`${service}:`))
  const est = d.operations.some((o) => o.cost_estimated)
  const days = Math.max(1, Math.round((a.last_ns - a.first_ns) / 86400e9))
  const topErr = d.errors[0]?.error_type

  return (
    <div className="page app-page">
      <div className="crumbs">
        <Link href="/apps">Apps</Link> › <span className="mono">{service}</span>
      </div>
      <h1 className="app-story">
        {a.calls ? (
          <>
            <b>{int(a.calls)}</b> model calls over {days} {days === 1 ? "day" : "days"} for <b>{usd(a.cost_usd)}</b>
            {est ? <span className="est">est.</span> : null}, typically answering in <b>{dur(a.p50_ms)}</b>.
            {a.failed ? (
              <>
                {" "}
                <span className="hl-err">{int(a.failed)} failed</span>
                {topErr ? <>, mostly {topErr}</> : null}.
              </>
            ) : (
              <> None failed.</>
            )}
          </>
        ) : (
          <>
            {int(a.spans)} spans from {service}, no model calls recognised.
          </>
        )}
      </h1>

      <div className="stat-strip">
        <Stat label="Calls" value={int(a.calls)} sub={`${int(a.traces)} traces`} />
        <Stat label={est ? "Cost (est.)" : "Cost"} value={usd(a.cost_usd)} sub={a.calls ? `${usd(a.cost_usd / a.calls)} per call` : ""} />
        <Stat label="Latency p50" value={dur(a.p50_ms)} sub={`p95 ${dur(a.p95_ms)}`} />
        <Stat label="First token p50" value={dur(a.ttft_p50_ms)} sub="when streamed" />
        <Stat label="Tokens" value={tok(a.input_tokens + a.output_tokens)} sub={a.input_tokens ? `${pct(a.cache_read_tokens / a.input_tokens)} from cache` : ""} />
      </div>

      {mine.length > 0 && (
        <section className="home-sec">
          <div className="sec-hd">
            <h2>Findings</h2>
          </div>
          <div className="app-findings">
            {mine.map((f) => {
              const [imp, unit] = impactParts(f)
              return (
                <Link key={f.id} href={`/findings?focus=${f.id}`} className="card next-card">
                  <div className="next-imp">
                    <span className="next-num">{imp}</span> <span className="mute">{unit}</span>
                  </div>
                  <div className="next-head">{f.headline.replace(`${service} · `, "").replace(`${service}: `, "")}</div>
                  <div className="next-rec">{f.recommendation}</div>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      <Groups title="Operations" hint="Grouped by the root span of each request, or the AI SDK function id" rows={d.operations} />
      <Groups title="Models" rows={d.models} />

      <div className="home-grid">
        <section className="home-sec">
          <div className="sec-hd">
            <h2>Recent requests</h2>
          </div>
          <div className="card list-card">
            {d.recent.slice(0, 15).map((r) => {
              const w = when(r.start_ns)
              return (
                <button type="button" key={r.trace_id} className="list-row req-row" onClick={() => nav(`/trace/${r.trace_id}?app=1`)}>
                  <span className={`req-dot${r.error ? " is-err" : ""}`} />
                  <span className="list-title mono">{r.name}</span>
                  <span className="num mute">
                    {w.date} {w.time}
                  </span>
                  <span className="num mute">{r.calls} calls</span>
                  <span className="num">{dur(r.duration_ms)}</span>
                  <span className="num">{usd(r.cost_usd)}</span>
                </button>
              )
            })}
          </div>
        </section>
        <section className="home-sec">
          <div className="sec-hd">
            <h2>Recent errors</h2>
          </div>
          {d.errors.length ? (
            <div className="card list-card">
              {d.errors.map((e) => (
                <button type="button" key={e.span_id} className="err-row" onClick={() => nav(`/trace/${e.trace_id}?span=${e.span_id}&app=1`)}>
                  <span className="mono err-text">{e.error_type || "error"}</span>
                  <span className="err-msg">{e.message || e.name}</span>
                  <span className="num mute">{when(e.start_ns).date}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="quiet-line">No errors.</div>
          )}
        </section>
      </div>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-row">
        <span className="stat-val">{value}</span>
      </div>
      <div className="stat-foot">{sub && <span className="mute">{sub}</span>}</div>
    </div>
  )
}

function Groups({ title, hint, rows }: { title: string; hint?: string; rows: AppGroup[] }) {
  if (!rows.length) return null
  const total = rows.reduce((s, r) => s + (r.cost_usd || 0), 0) || 1
  return (
    <section className="home-sec">
      <div className="sec-hd">
        <h2>{title}</h2>
        {hint && <span className="sec-sub">{hint}</span>}
      </div>
      <table className="grid app-table">
        <thead>
          <tr>
            <th>{title === "Models" ? "Model" : "Operation"}</th>
            <th className="r">Calls</th>
            <th className="r">Cost</th>
            <th>Share</th>
            <th className="r">Tokens in / out</th>
            <th className="r">p50</th>
            <th className="r">p95</th>
            <th className="r">Failed</th>
          </tr>
        </thead>
        <tbody className="stagger">
          {rows.map((r) => (
            <tr key={r.key}>
              <td>
                {title === "Models" ? <ModelName model={r.key} /> : <span className="mono">{r.key}</span>}
                {title !== "Models" && r.models.length > 0 && <span className="mute"> · {r.models.map((m) => modelName(m) || m).join(", ")}</span>}
              </td>
              <td className="num r">{int(r.calls)}</td>
              <td className="num r">{usd(r.cost_usd)}</td>
              <td>
                <span className="share-bar">
                  <i style={{ width: `${((r.cost_usd || 0) / total) * 100}%` }} />
                </span>
              </td>
              <td className="num r">
                {tok(r.avg_input_tokens)} / {tok(r.avg_output_tokens)}
              </td>
              <td className="num r">{dur(r.p50_ms)}</td>
              <td className="num r">{dur(r.p95_ms)}</td>
              <td className={`num r${r.failed ? " err-text" : ""}`}>{r.failed ? int(r.failed) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
