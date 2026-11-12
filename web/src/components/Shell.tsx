import { useEffect, useMemo, useRef, useState, createContext, useContext } from "react"
import {
  ChartPie,
  Cube,
  Lightbulb,
  ListBullets,
  Sun,
  type Icon,
} from "@phosphor-icons/react"
import { Link, useLocation } from "wouter"
import { api, emptyMode, onReconnect } from "../lib/api"
import { startPoll } from "../lib/poll"
import type { Theme } from "../lib/theme"
import { StatusContext } from "../lib/status"
import type { AppSummary, Finding, Status } from "../lib/types"
import { desktop, displayVersion, windowKind, type UpdateState } from "../lib/desktop"
import { hashParam } from "../lib/hash"
import { CommandPalette } from "./CommandPalette"
import { onWins, openFindings, resolvedKeys } from "../lib/wins"

type Item = {
  href: string
  label: string
  icon: Icon
  key: string
  match?: (loc: string) => boolean
}

const NAV: Item[] = [
  { href: "/", label: "Today", icon: Sun, key: "h", match: (l) => l === "/" },
  {
    href: "/sessions",
    label: "Sessions",
    icon: ListBullets,
    key: "s",
    match: (l) => l.startsWith("/sessions") || l.startsWith("/session/") || (l.startsWith("/trace/") && !fromApps()),
  },
  { href: "/findings", label: "Findings", icon: Lightbulb, key: "f" },
  { href: "/spend", label: "Spend", icon: ChartPie, key: "c", match: (l) => l === "/spend" || l === "/cost" || l === "/recap" },
]

function fromApps(): boolean {
  return /[?&]app=1/.test(window.location.hash) || /[?&]app=1/.test(window.location.search)
}

type ShellApi = { openCommand: () => void; mock: boolean; openFindings: number }

const ShellCtx = createContext<ShellApi>({ openCommand: () => {}, mock: false, openFindings: 0 })
export function useShell() {
  return useContext(ShellCtx)
}

export function Shell({
  children,
  theme: _theme,
  onTheme,
  mock,
}: {
  children: React.ReactNode
  theme: Theme
  onTheme: (t: Theme) => void
  mock: boolean
}) {
  const [cmd, setCmd] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [apps, setApps] = useState<AppSummary[]>([])
  const [findings, setFindings] = useState<Finding[]>([])
  const [resolved, setResolved] = useState(() => resolvedKeys())
  const [loc, nav] = useLocation()
  const [inactive, setInactive] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const pendingG = useRef(0)
  const prefs = windowKind() === "settings"

  useEffect(() => {
    const on = () => setInactive(!document.hasFocus())
    window.addEventListener("blur", on)
    window.addEventListener("focus", on)
    return () => {
      window.removeEventListener("blur", on)
      window.removeEventListener("focus", on)
    }
  }, [])

  useEffect(() => onReconnect(setReconnecting), [])

  useEffect(() => {
    let alive = true
    const stop = startPoll(async () => {
      const s = await api.status()
      if (alive) setStatus(s)
    }, { visibleMs: 15000, hiddenMs: 60000 })
    api.apps().then((a) => alive && setApps(a)).catch(() => undefined)
    api.findings().then((rows) => alive && setFindings(rows)).catch(() => undefined)
    return () => {
      alive = false
      stop()
    }
  }, [])

  useEffect(() => onWins(() => setResolved(resolvedKeys())), [])

  useEffect(() => {
    const api = desktop()
    if (!api) return
    let off = () => {}
    api.getUpdate().then(setUpdate).catch(() => {})
    off = api.onUpdate(setUpdate)
    return () => off()
  }, [])

  useEffect(() => {
    const api = desktop()
    if (!api?.getAccentColor) return
    const apply = (hex: string) => {
      if (hex) document.documentElement.style.setProperty("--accent", hex.startsWith("#") ? hex : `#${hex}`)
    }
    api.getAccentColor().then(apply).catch(() => {})
    return api.onAccentColor ? api.onAccentColor(apply) : undefined
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setCmd((v) => !v)
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault()
        const d = desktop()
        if (d?.openSettings) d.openSettings()
        else nav("/settings")
        return
      }
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "g") {
        pendingG.current = Date.now()
        return
      }
      if (Date.now() - pendingG.current < 1200) {
        pendingG.current = 0
        if (e.key === ",") {
          nav("/settings")
          e.preventDefault()
          return
        }
        const hit = [...NAV, { href: "/apps", label: "Apps", icon: Cube, key: "a" }, { href: "/query", label: "Query", icon: ChartPie, key: "q" }].find(
          (i) => i.key === e.key,
        )
        if (hit) {
          nav(hit.href)
          e.preventDefault()
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [nav])

  const openCount = findings.length ? openFindings(findings, resolved).length : status?.findings || 0
  const shell = useMemo(() => ({ openCommand: () => setCmd(true), mock, openFindings: openCount }), [mock, openCount])
  const running = (status?.running || 0) > 0 && !emptyMode() && hashParam("welcome") == null
  const appSources = apps.filter((a) => a.service)

  return (
    <StatusContext.Provider value={status}>
      <ShellCtx.Provider value={shell}>
        <div className={`win${prefs ? " prefs" : ""}${inactive ? " is-inactive" : ""}`}>
          {!prefs && (
            <aside className="side" aria-label="Main">
              <div className="lights" aria-hidden="true" />
              <div className="grp">
                {NAV.map((it) => (
                  <NavItem
                    key={it.href}
                    item={it}
                    badge={
                      it.href === "/sessions" && running ? (
                        <span className="live" title={`${status?.running} running`} />
                      ) :                       it.href === "/findings" && openCount > 0 ? (
                        <span className="ct">{openCount}</span>
                      ) : null
                    }
                  />
                ))}
              </div>
              {appSources.length > 0 && (
                <div className="grp">
                  <div className="grp-h">Apps</div>
                  {appSources.map((a) => (
                    <Link
                      key={a.service}
                      href={`/apps/${encodeURIComponent(a.service)}`}
                      className={`nav${loc.includes(`/apps/${a.service}`) ? " on" : ""}`}
                    >
                      <Cube size={16} weight={loc.includes(`/apps/${a.service}`) ? "fill" : "regular"} />
                      <span>{a.service}</span>
                    </Link>
                  ))}
                </div>
              )}
              <div className="foot recv">
                <StatusDot status={status} reconnecting={reconnecting} />
                {update?.status === "ready" ? (
                  <button
                    type="button"
                    className="side-update"
                    data-update="ready"
                    onClick={() => desktop()?.restartToUpdate()}
                  >
                    Restart to update{displayVersion(update.version) ? ` · ${displayVersion(update.version)}` : ""}
                  </button>
                ) : null}
                {mock && <span className="demo">Demo data</span>}
              </div>
            </aside>
          )}
          <main className="main">
            {import.meta.env.VITE_DEMO === "1" && (
              <div className="demo-banner">
                You are looking at synthetic demo data.
              </div>
            )}
            <div key={loc.split("?")[0]} className="page-in">
              {children}
            </div>
          </main>
        </div>
        <CommandPalette open={cmd} onClose={() => setCmd(false)} onTheme={() => onTheme(_theme === "dark" ? "light" : "dark")} />
      </ShellCtx.Provider>
    </StatusContext.Provider>
  )
}

function NavItem({ item, badge }: { item: Item; badge: React.ReactNode }) {
  const [loc] = useLocation()
  const on = item.match ? item.match(loc) : loc === item.href || loc.startsWith(`${item.href}/`)
  const Icon = item.icon
  return (
    <Link href={item.href} className={`nav${on ? " on" : ""}`} aria-current={on ? "page" : undefined} title={`${item.label} (g ${item.key})`}>
      <Icon size={16} weight={on ? "fill" : "regular"} />
      <span>{item.label}</span>
      {badge}
    </Link>
  )
}

function StatusDot({ status, reconnecting }: { status: Status | null; reconnecting: boolean }) {
  if (reconnecting) return <span data-reconnect=""><span className="dot off" />Reconnecting…</span>
  if (emptyMode()) return <><span className="dot off" />Not tracing yet</>
  if (!status) return <><span className="dot off" />Connecting…</>
  if (!status.last_ns) return <><span className="dot off" />Not tracing yet</>
  const fresh = Date.now() * 1e6 - status.last_ns < 5 * 60e9
  if (status.history?.found && !status.live_otel) {
    return <><span className="dot off" />History only</>
  }
  return (
    <>
      <span className={`dot${fresh ? "" : " off"}`} />
      {fresh ? "Receiving" : "History only"}
    </>
  )
}
