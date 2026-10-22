import { useEffect, useState } from "react"
import { ArrowRight, Boxes } from "lucide-react"
import { Link, useLocation } from "wouter"
import { api } from "../lib/api"
import { ago, dur, int, pct, usd } from "../lib/format"
import type { AppSummary } from "../lib/types"
import { Sparkline } from "../components/Sparkline"
import { useNow } from "../hooks/useNow"

export function AppsPage() {
  const [apps, setApps] = useState<AppSummary[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [, nav] = useLocation()
  const now = useNow(5000)

  useEffect(() => {
    let alive = true
    const load = () =>
      api
        .apps()
        .then((a) => alive && setApps(a))
        .catch((e: Error) => alive && setErr(e.message))
    load()
    const t = window.setInterval(load, 15000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [])

  if (err && !apps) return <div className="page">{err}</div>
  if (!apps) return <div className="page mute">Loading apps…</div>

  return (
    <div className="page apps">
      <h1>Apps</h1>
      <div className="sub">
        Your own services and agents sending OpenTelemetry. Model calls are recognised from the GenAI conventions, the Claude SDK, OpenLLMetry,
        OpenInference, the Vercel AI SDK and Pydantic AI. Cost is estimated from tokens when an app does not report it.
      </div>
      {!apps.length ? (
        <div className="first-run">
          <div className="fr-mark">
            <Boxes size={18} />
          </div>
          <h1>No apps yet</h1>
          <p>Point any app that calls a model at Aftertrace. Calls, cost, latency and failures show up here per app and per operation.</p>
          <Link href="/connect" className="btn">
            Connect an app <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <div className="app-grid">
          {apps.map((a) => (
            <button type="button" key={a.service} className="app-card" onClick={() => nav(`/apps/${encodeURIComponent(a.service)}`)}>
              <div className="app-hd">
                <span className={`recv-dot${a.live ? " is-on" : ""}`} />
                <span className="app-name mono">{a.service}</span>
                <span className="mute app-seen">{ago(a.last_ns, now)}</span>
              </div>
              {a.calls ? (
                <>
                  <div className="app-nums">
                    <div>
                      <div className="stat-label">Calls</div>
                      <div className="app-val">{int(a.calls)}</div>
                    </div>
                    <div>
                      <div className="stat-label">Cost</div>
                      <div className="app-val">{usd(a.cost_usd)}</div>
                    </div>
                    <div>
                      <div className="stat-label">p50</div>
                      <div className="app-val">{dur(a.p50_ms)}</div>
                    </div>
                    <div>
                      <div className="stat-label">Failed</div>
                      <div className={`app-val${a.failed ? " err-text" : ""}`}>{a.failed ? pct(a.failed / a.calls) : "0"}</div>
                    </div>
                  </div>
                  <div className="app-foot">
                    <span className="app-models">
                      {a.models.map((m) => (
                        <span key={m} className="chip mono">
                          {m}
                        </span>
                      ))}
                    </span>
                    <Sparkline values={a.daily_cost} width={120} />
                  </div>
                </>
              ) : (
                <div className="mute app-empty">
                  {int(a.spans)} spans, no model calls recognised yet. If this app calls a model, check that its SDK's OpenTelemetry instrumentation is on.
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
