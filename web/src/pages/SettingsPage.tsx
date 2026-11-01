import { useEffect, useState } from "react"
import { Link } from "wouter"
import { useStatus } from "../lib/status"
import { CopyButton } from "../components/CopyButton"
import { int } from "../lib/format"
import { useHashQuery } from "../lib/hash"
import { PLANS, readPlan, writePlan, type Plan } from "../lib/plan"
import { ConnectPage } from "./ConnectPage"
import { QueryPage } from "./QueryPage"

type Tab = "plan" | "sources" | "query"

export function SettingsPage() {
  const status = useStatus()
  const q = useHashQuery()
  const raw = q.get("tab")
  const tab: Tab = raw === "sources" || raw === "query" ? raw : "plan"
  const [plan, setPlan] = useState<Plan | null>(() => readPlan())
  useEffect(() => {
    const on = () => setPlan(readPlan())
    window.addEventListener("aftertrace-plan", on)
    return () => window.removeEventListener("aftertrace-plan", on)
  }, [])
  const info = status?.info
  const db = info?.db_path || "~/.aftertrace/aftertrace.duckdb"

  if (tab === "sources") {
    const welcome = q.get("welcome")
    return (
      <div className="settings-rd is-wide">
        {welcome ? null : <Tabs tab={tab} />}
        <ConnectPage />
      </div>
    )
  }
  if (tab === "query") {
    return (
      <div className="settings-rd is-wide">
        <Tabs tab={tab} />
        <QueryPage />
      </div>
    )
  }

  return (
    <div className="settings-rd">
      <h1>Settings</h1>
      <Tabs tab={tab} />

      <section className="set-sec">
        <h2>Your plan</h2>
        <div className="plan-opts" role="radiogroup" aria-label="Plan">
          <button type="button" role="radio" aria-checked={!plan} className={`plan-opt${!plan ? " on" : ""}`} onClick={() => writePlan(null)}>
            Not set
          </button>
          {PLANS.map((p) => (
            <button type="button" role="radio" aria-checked={plan?.id === p.id} key={p.id} className={`plan-opt${plan?.id === p.id ? " on" : ""}`} onClick={() => writePlan(p)}>
              {p.label}
            </button>
          ))}
        </div>
      </section>

      <section className="set-sec">
        <h2>What is captured</h2>
        <div className="gates">
          <Gate on label="Timing, cost, tokens, tool names" detail="Always. This is what every view is built on." />
          <Gate
            on={Boolean(info?.store_content)}
            label="Prompts, responses and tool output"
            detail={
              info?.store_content
                ? "Kept. This server runs with --store-content."
                : "Dropped at ingest. Start aftertrace serve with --store-content to keep them."
            }
          />
          <Gate on={false} label="Your email, account and org ids, OS user name" detail="Always dropped at ingest, whatever the flags." />
          <Gate
            on={Boolean(status?.ask.enabled)}
            label={status?.ask.enabled ? `Ask is on (${status.ask.model})` : "Ask is off"}
            detail={
              status?.ask.enabled
                ? "Questions, the schema and query rows go to the Anthropic API. Nothing else leaves this machine."
                : "Nothing leaves this machine. Start aftertrace serve --ask with ANTHROPIC_API_KEY set to answer English questions."
            }
          />
        </div>
      </section>

      <section className="set-sec">
        <h2>This server</h2>
        <dl className="kv">
          <dt>Version</dt>
          <dd className="mono">{info?.version || "…"}</dd>
          <dt>Database</dt>
          <dd className="mono">
            {db} <CopyButton text={db} label="" className="icon-btn icon-sm" />
          </dd>
          <dt>OTLP</dt>
          <dd className="mono">
            gRPC {info?.otlp_grpc || "…"} · HTTP {info?.otlp_http || "…"}
          </dd>
          <dt>Stored</dt>
          <dd className="mono">
            {status
              ? `${int(status.counts.Spans)} spans · ${int(status.counts.Events)} events · ${int(status.counts.MetricPoints)} metric points · ${int(status.sessions)} sessions`
              : "…"}
          </dd>
        </dl>
      </section>
    </div>
  )
}

function Tabs({ tab }: { tab: Tab }) {
  return (
    <div className="set-tabs">
      <Link href="/settings" className={tab === "plan" ? "on" : ""}>
        Plan
      </Link>
      <Link href="/settings?tab=sources" className={tab === "sources" ? "on" : ""}>
        Sources
      </Link>
      <Link href="/settings?tab=query" className={tab === "query" ? "on" : ""}>
        Advanced
      </Link>
    </div>
  )
}

function Gate({ on, label, detail }: { on: boolean; label: string; detail: string }) {
  return (
    <div className={`gate${on ? " is-on" : ""}`}>
      <span className="gate-dot" aria-hidden="true" />
      <div>
        <div className="gate-label">
          {label} <span className="gate-state">{on ? "on" : "off"}</span>
        </div>
        <div className="mute">{detail}</div>
      </div>
    </div>
  )
}
