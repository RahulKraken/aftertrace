import { useState } from "react"
import { useLocation } from "wouter"
import { dur, usd, when } from "../lib/format"
import type { AppDetail } from "../lib/types"

// Recent requests as dots: across is when, up is how long. Slow outliers and
// failures stand out without reading a table, and every dot opens its trace.
export function RequestScatter({ rows }: { rows: AppDetail["recent"] }) {
  const [, nav] = useLocation()
  const [hover, setHover] = useState<number | null>(null)
  if (rows.length < 3) return null
  const W = 1000
  const H = 160
  const P = 10
  const t0 = Math.min(...rows.map((r) => r.start_ns))
  const t1 = Math.max(...rows.map((r) => r.start_ns))
  const maxMs = Math.max(...rows.map((r) => r.duration_ms), 1)
  // Square-root scale: a few very slow requests do not flatten the rest.
  const y = (ms: number) => H - P - Math.sqrt(ms / maxMs) * (H - P * 2)
  const x = (ns: number) => P + ((ns - t0) / Math.max(t1 - t0, 1)) * (W - P * 2)
  const h = hover != null ? rows[hover] : null
  const order = rows.map((r, i) => ({ r, i })).sort((a, b) => a.r.start_ns - b.r.start_ns)
  return (
    <div className="scatter card" onMouseLeave={() => setHover(null)}>
      <div className="act-head">
        <span className="act-title">Recent requests</span>
        <span className="act-read">
          {h ? (
            <>
              <b>{h.name}</b> · {dur(h.duration_ms)} · {h.calls} {h.calls === 1 ? "call" : "calls"}
              {h.cost_usd != null ? ` · ${usd(h.cost_usd)}` : ""} · {when(h.start_ns).date} {when(h.start_ns).time}
              {h.error ? <span className="err-text"> · failed</span> : null}
            </>
          ) : (
            <span className="mute">Higher is slower; rose failed. Click a dot to open it.</span>
          )}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="scatter-svg" role="img" aria-label="Recent requests by time and duration">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} className="scatter-grid" />
        ))}
      </svg>
      <div className="scatter-dots">
        {order.map(({ r, i }, k) => (
          <button
            type="button"
            key={r.trace_id}
            className={`sdot${r.error ? " is-err" : ""}${hover === i ? " is-hot" : ""}`}
            style={{ left: `${(x(r.start_ns) / W) * 100}%`, top: `${(y(r.duration_ms) / H) * 100}%`, ["--i" as string]: Math.min(k, 40) }}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onClick={() => nav(`/trace/${r.trace_id}`)}
            aria-label={`${r.name}, ${dur(r.duration_ms)}${r.error ? ", failed" : ""}`}
          />
        ))}
      </div>
    </div>
  )
}
