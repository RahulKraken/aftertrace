import { useEffect, useState } from "react"
import { Link } from "wouter"
import { useStatus } from "../lib/status"
import { CopyButton } from "../components/CopyButton"
import { int } from "../lib/format"
import { PLANS, readPlan, writePlan, type Plan } from "../lib/plan"

export function SettingsPage() {
  const status = useStatus()
  const [plan, setPlan] = useState<Plan | null>(() => readPlan())
  useEffect(() => {
    const on = () => setPlan(readPlan())
    window.addEventListener("aftertrace-plan", on)
    return () => window.removeEventListener("aftertrace-plan", on)
  }, [])
  const info = status?.info
  const db = info?.db_path || "~/.aftertrace/aftertrace.duckdb"

  return (
    <div className="page settings">
      <h1>Settings</h1>
      <div className="sub">Aftertrace keeps everything in one file on this machine. These settings say what it stores and what, if anything, leaves.</div>

      <section className="set-sec">
        <h2>Your plan</h2>
        <p className="mute">
          Used only to say whether a single Claude plan paid for itself. For everything you pay for, use{" "}
          <Link href="/plans">Plans</Link>. Stored in this browser.
        </p>
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
                ? "Kept. This server runs with --store-content. Claude Code still has to send them (OTEL_LOG_USER_PROMPTS, OTEL_LOG_ASSISTANT_RESPONSES, OTEL_LOG_TOOL_CONTENT)."
                : "Dropped at ingest. Start aftertrace serve with --store-content, and turn the content flags on in Claude Code, to keep them."
            }
          />
          <Gate on={false} label="Your email, account and org ids, OS user name" detail="Always dropped at ingest, whatever the flags." />
          <Gate
            on={Boolean(status?.ask.enabled)}
            label={status?.ask.enabled ? `Ask is on (${status.ask.model})` : "Ask is off"}
            detail={
              status?.ask.enabled
                ? "Questions, the schema and query rows (strings cut to 200 characters) go to the Anthropic API. Nothing else leaves this machine."
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
        <p className="mute">
          To wipe everything, stop the server and delete the database file and its <code>.wal</code>. To add a source, go to{" "}
          <Link href="/connect">Connect</Link>.
        </p>
      </section>
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
