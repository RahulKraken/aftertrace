import { useEffect, useRef, useState } from "react"
import {
  Boxes,
  CircleDollarSign,
  House,
  Lightbulb,
  Wallet,
  Moon,
  Plug,
  Receipt,
  Rows3,
  Search,
  Settings,
  SquareTerminal,
  Sun,
  type LucideIcon,
} from "lucide-react"
import { Link, useLocation } from "wouter"
import { api } from "../lib/api"
import { ago } from "../lib/format"
import type { Theme } from "../lib/theme"
import { StatusContext } from "../lib/status"
import type { Status } from "../lib/types"
import { useNow } from "../hooks/useNow"
import { CommandPalette } from "./CommandPalette"
import { Logo } from "./Logo"

type Item = { href: string; label: string; icon: LucideIcon; key: string; match?: (loc: string) => boolean }

const TOP: Item = { href: "/", label: "Home", icon: House, key: "h", match: (l) => l === "/" }
const GROUPS: { label: string; items: Item[] }[] = [
  {
    label: "Observe",
    items: [
      {
        href: "/sessions",
        label: "Sessions",
        icon: Rows3,
        key: "s",
        match: (l) => l.startsWith("/sessions") || l.startsWith("/session/") || (l.startsWith("/trace/") && !fromApps()),
      },
      { href: "/apps", label: "Apps", icon: Boxes, key: "a", match: (l) => l.startsWith("/apps") || (l.startsWith("/trace/") && fromApps()) },
    ],
  },
  {
    label: "Improve",
    items: [
      { href: "/findings", label: "Findings", icon: Lightbulb, key: "f" },
      { href: "/cost", label: "Cost", icon: CircleDollarSign, key: "c" },
      { href: "/plans", label: "Plans", icon: Wallet, key: "p" },
    ],
  },
  {
    label: "Explore",
    items: [
      { href: "/query", label: "Query", icon: SquareTerminal, key: "q" },
      { href: "/recap", label: "Recap", icon: Receipt, key: "r" },
    ],
  },
]
const BOTTOM: Item[] = [
  { href: "/connect", label: "Connect", icon: Plug, key: "n" },
  { href: "/settings", label: "Settings", icon: Settings, key: "," },
]
const ALL = [TOP, ...GROUPS.flatMap((g) => g.items), ...BOTTOM]

// App pages open traces with ?app=1 so the sidebar keeps Apps selected.
function fromApps(): boolean {
  return /[?&]app=1/.test(window.location.hash) || /[?&]app=1/.test(window.location.search)
}

export function Shell({
  children,
  theme,
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
  const [loc, nav] = useLocation()
  const pendingG = useRef(0)

  useEffect(() => {
    let alive = true
    const load = () =>
      api
        .status()
        .then((s) => alive && setStatus(s))
        .catch(() => undefined)
    load()
    const t = window.setInterval(load, 5000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setCmd((v) => !v)
        return
      }
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.metaKey || e.ctrlKey || e.altKey) return
      // "g" then a letter jumps to a page, like Linear and GitHub.
      if (e.key === "g") {
        pendingG.current = Date.now()
        return
      }
      if (Date.now() - pendingG.current < 1200) {
        const hit = ALL.find((i) => i.key === e.key)
        pendingG.current = 0
        if (hit) {
          nav(hit.href)
          e.preventDefault()
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [nav])

  const counts: Record<string, React.ReactNode> = {
    "/": status && status.running > 0 ? <span className="live-count" title={`${status.running} running`}>{status.running}</span> : null,
    "/findings": status && status.findings > 0 ? <span className="side-count">{status.findings}</span> : null,
    "/apps": status && status.apps > 0 ? <span className="side-count">{status.apps}</span> : null,
  }

  return (
    <StatusContext.Provider value={status}>
      <div className="app">
        <aside className="side" aria-label="Main">
          <Link href="/" className="brand">
            <Logo size={18} />
            <span>aftertrace</span>
            {mock && <span className="tag warn">demo</span>}
          </Link>
          <button type="button" className="side-search" onClick={() => setCmd(true)}>
            <Search size={14} />
            <span>Search</span>
            <kbd>⌘K</kbd>
          </button>
          <nav className="side-nav">
            <NavItem item={TOP} badge={counts["/"]} />
            {GROUPS.map((g) => (
              <div className="side-group" key={g.label}>
                <div className="side-label">{g.label}</div>
                {g.items.map((it) => (
                  <NavItem key={it.href} item={it} badge={counts[it.href]} />
                ))}
              </div>
            ))}
          </nav>
          <div className="side-foot">
            {BOTTOM.map((it) => (
              <NavItem key={it.href} item={it} badge={null} />
            ))}
            <div className="side-status">
              <ReceivingLine status={status} />
              <button
                type="button"
                className="icon-btn"
                aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                title="Toggle theme"
                onClick={() => onTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
              </button>
            </div>
          </div>
        </aside>
        <main className="main">
          {import.meta.env.VITE_DEMO === "1" && (
            <div className="demo-banner">
              You are looking at synthetic demo data. <a href="../docs/install.html">Install Aftertrace</a> to see your own Claude Code, agents and apps.
            </div>
          )}
          {/* Keyed by page, not by query: switching Story and Timeline is not a new page. */}
          <div key={pageKey(loc)} className="page-in">
            {children}
          </div>
        </main>
      </div>
      <CommandPalette open={cmd} onClose={() => setCmd(false)} onTheme={() => onTheme(theme === "dark" ? "light" : "dark")} />
    </StatusContext.Provider>
  )
}

function NavItem({ item, badge }: { item: Item; badge: React.ReactNode }) {
  const [loc] = useLocation()
  const on = item.match ? item.match(loc) : loc === item.href || loc.startsWith(`${item.href}/`)
  const Icon = item.icon
  return (
    <Link href={item.href} className={`side-item${on ? " on" : ""}`} aria-current={on ? "page" : undefined} title={`${item.label} (g ${item.key})`}>
      <Icon size={15} strokeWidth={1.8} />
      <span className="side-text">{item.label}</span>
      {badge}
    </Link>
  )
}

// One line of feedback that data is flowing (Norman: feedback, visibility).
function ReceivingLine({ status }: { status: Status | null }) {
  const now = useNow(1000)
  if (!status) return <span className="recv">Connecting…</span>
  if (!status.last_ns) {
    return (
      <Link href="/connect" className="recv is-idle">
        <i className="recv-dot" /> Waiting for data
      </Link>
    )
  }
  const fresh = now * 1e6 - status.last_ns < 5 * 60e9
  return (
    <span className={`recv${fresh ? " is-live" : ""}`} title="Last data received">
      <i className="recv-dot" /> {fresh ? "Receiving" : "Last data"} · {ago(status.last_ns, now)}
    </span>
  )
}

function pageKey(loc: string): string {
  return loc.split("?")[0]
}
