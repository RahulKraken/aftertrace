import { useEffect, useState } from "react"
import { ArrowClockwise, Gear, Plugs, ShieldCheck } from "@phosphor-icons/react"
import { CopyButton } from "../components/CopyButton"
import { useStatus } from "../lib/status"
import { ago } from "../lib/format"
import { hashParam } from "../lib/hash"
import { desktop, displayVersion, windowKind, type UpdateState } from "../lib/desktop"
import { PLANS, readPlan, writePlan, type Plan } from "../lib/plan"
import { readBudget, writeBudget } from "../lib/budget"
import { switchTheme, type Theme } from "../lib/theme"
import { ConnectSources } from "./ConnectPage"

type Tab = "general" | "sources" | "privacy" | "updates"

const TABS: { id: Tab; label: string; Icon: typeof Gear }[] = [
  { id: "general", label: "General", Icon: Gear },
  { id: "sources", label: "Sources", Icon: Plugs },
  { id: "privacy", label: "Privacy", Icon: ShieldCheck },
  { id: "updates", label: "Updates", Icon: ArrowClockwise },
]

export function SettingsPage() {
  const status = useStatus()
  const shell = desktop()
  const prefs = windowKind() === "settings"
  const [tab, setTab] = useState<Tab>(() => (hashParam("tab") as Tab) || "general")
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [plan, setPlan] = useState<Plan | null>(() => readPlan())
  const [theme, setTheme] = useState<Theme | "system">(() => {
    const saved = window.localStorage.getItem("aftertrace-theme")
    return saved === "dark" || saved === "light" ? saved : "system"
  })
  const [budget, setBudget] = useState<string>(() => {
    const b = readBudget()
    return b ? String(b.weekly) : ""
  })
  const [openAtLogin, setOpenAtLogin] = useState(false)

  useEffect(() => {
    if (!shell) return
    shell.getUpdate().then(setUpdate).catch(() => {})
    shell.getOpenAtLogin?.().then(setOpenAtLogin).catch(() => {})
    return shell.onUpdate(setUpdate)
  }, [shell])

  useEffect(() => {
    const onHash = () => {
      const t = hashParam("tab") as Tab | null
      if (t === "general" || t === "sources" || t === "privacy" || t === "updates") setTab(t)
    }
    onHash()
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])

  const info = status?.info
  const db = info?.db_path || "~/.aftertrace/aftertrace.duckdb"
  const go = (id: Tab) => {
    setTab(id)
    window.location.hash = id === "general" ? "#/settings" : `#/settings?tab=${id}`
  }

  return (
    <div className={`set-win${prefs ? " is-window" : ""}`}>
      <div className="set-tb">
        <h1>Settings</h1>
        <div className="set-tabs" role="tablist" aria-label="Settings">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`set-tab${tab === id ? " on" : ""}`}
              onClick={() => go(id)}
            >
              <Icon size={22} weight={tab === id ? "fill" : "regular"} />
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="prefs-body">
        {tab === "general" && (
          <>
            <div className="set-sec">
              <h2>Appearance</h2>
              <div className="set-row">
                <span className="k">Theme</span>
                <select
                  className="select"
                  value={theme}
                  onChange={(e) => {
                    const v = e.target.value as Theme | "system"
                    setTheme(v)
                    if (v === "system") {
                      window.localStorage.removeItem("aftertrace-theme")
                      const dark = window.matchMedia("(prefers-color-scheme: dark)").matches
                      document.documentElement.dataset.theme = dark ? "dark" : "light"
                    } else {
                      switchTheme(v, () => {})
                    }
                  }}
                >
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </div>
            </div>
            <div className="set-sec">
              <h2>Plan</h2>
              <div className="set-row">
                <span className="k">Claude plan</span>
                <select
                  className="select"
                  value={plan?.id || ""}
                  onChange={(e) => {
                    const p = PLANS.find((x) => x.id === e.target.value) || null
                    writePlan(p)
                    setPlan(p)
                  }}
                >
                  <option value="">Not set</option>
                  {PLANS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              {shell?.getOpenAtLogin ? (
                <div className="set-row">
                  <span className="k">Open at login</span>
                  <label className="opt">
                    <input
                      type="checkbox"
                      checked={openAtLogin}
                      onChange={async (e) => {
                        const on = e.target.checked
                        setOpenAtLogin(on)
                        await shell.setOpenAtLogin?.(on)
                      }}
                    />
                    <span>Start Aftertrace when you log in</span>
                  </label>
                </div>
              ) : null}
              <div className="set-row">
                <span className="k">Weekly budget</span>
                <label className="budget-field">
                  <span className="l2">$</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    placeholder="none"
                    value={budget}
                    onChange={(e) => {
                      const v = e.target.value
                      setBudget(v)
                      writeBudget(v === "" ? null : Number(v))
                    }}
                  />
                  <span className="l2 budget-suffix">/ week</span>
                </label>
              </div>
            </div>
          </>
        )}
        {tab === "sources" && <ConnectSources embedded />}
        {tab === "privacy" && (
          <>
            <div className="set-sec">
              <h2>What is captured</h2>
              <Gate on label="Timing, cost, tokens, tool names" detail="Always. This is what every view is built on." />
              <Gate
                on={Boolean(info?.store_content)}
                label="Prompts, responses and tool output"
                detail={
                  info?.store_content
                    ? "Kept. This server runs with --store-content."
                    : "Dropped at ingest unless you start aftertrace serve with --store-content."
                }
              />
              <Gate on={false} label="Email, account and org ids" detail="Always dropped at ingest." />
              <Gate
                on={Boolean(status?.ask.enabled)}
                label={status?.ask.enabled ? `Ask is on (${status.ask.model})` : "Ask is off"}
                detail={
                  status?.ask.enabled
                    ? "Questions and query rows go to the Anthropic API. Nothing else leaves this machine."
                    : "Nothing leaves this machine."
                }
              />
            </div>
            <div className="set-sec">
              <h2>This server</h2>
              <div className="set-row">
                <span className="k">Version</span>
                <span className="mono">{info?.version || "…"}</span>
              </div>
              <div className="set-row">
                <span className="k">Database</span>
                <span className="mono">
                  {db} <CopyButton text={db} label="" className="ibtn" />
                </span>
              </div>
              <div className="set-row">
                <span className="k">OTLP</span>
                <span className="mono">
                  gRPC {info?.otlp_grpc || "…"} · HTTP {info?.otlp_http || "…"}
                </span>
              </div>
            </div>
          </>
        )}
        {tab === "updates" && (
          <div className="set-sec" data-settings="updates">
            {shell ? (
              <>
                <div className="set-row">
                  <span className="k">App</span>
                  <span>
                    {update?.status === "ready" && update.version ? (
                      <>Version {String(update.version).replace(/^v/i, "")} is ready. Restart to update.</>
                    ) : (
                      <span className="mono">{displayVersion(update?.current) || "…"}</span>
                    )}
                  </span>
                </div>
                <div className="set-row">
                  <span className="k">Last checked</span>
                  <span>{update?.checkedAt ? ago(update.checkedAt * 1e6) : "never"}</span>
                </div>
                <div className="set-row">
                  <span className="k" />
                  <span className="set-acts">
                    <button type="button" className="btn" onClick={() => shell.checkUpdates()}>
                      Check for updates
                    </button>
                    {update?.status === "ready" ? (
                      <button type="button" className="btn pri" data-update="ready" onClick={() => shell.restartToUpdate()}>
                        Restart to update
                      </button>
                    ) : null}
                  </span>
                </div>
              </>
            ) : (
              <p className="l2">Updates are checked by the Mac app.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Gate({ on, label, detail }: { on: boolean; label: string; detail: string }) {
  return (
    <div className="set-row gate" style={{ alignItems: "start" }}>
      <span className="k">{label}</span>
      <span>
        <span className={on ? "sw-on" : "sw-off"} aria-hidden>
          <i />
        </span>
        <div className="d">{detail}</div>
      </span>
    </div>
  )
}
