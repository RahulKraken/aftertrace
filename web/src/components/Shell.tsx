import { useEffect, useRef, useState } from "react"
import { Moon, Search, Settings, Sun } from "lucide-react"
import { Link, useLocation } from "wouter"
import { api } from "../lib/api"
import type { Theme } from "../lib/theme"
import { StatusContext } from "../lib/status"
import type { Status } from "../lib/types"
import { CommandPalette } from "./CommandPalette"
import { Logo } from "./Logo"

type Item = { href: string; label: string; key: string; match?: (loc: string) => boolean; count?: boolean }

const NAV: Item[] = [
  { href: "/", label: "Home", key: "h", match: (l) => l === "/" },
  { href: "/findings", label: "Findings", key: "f", count: true },
  {
    href: "/sessions",
    label: "Sessions",
    key: "s",
    match: (l) => l.startsWith("/sessions") || l.startsWith("/session/") || l.startsWith("/apps") || l.startsWith("/trace/"),
  },
  { href: "/recap", label: "Recap", key: "r" },
]

const JUMP: Item[] = [
  ...NAV,
  { href: "/sessions?src=apps", label: "Apps", key: "a" },
  { href: "/recap", label: "Cost", key: "c" },
  { href: "/settings?tab=query", label: "Query", key: "q" },
  { href: "/settings?tab=sources", label: "Connect", key: "n" },
  { href: "/settings", label: "Settings", key: "," },
]

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
    if (mock || !status || loc !== "/") return
    try {
      if (localStorage.getItem("aftertrace.welcome")) return
      if (!status.live_otel) {
        localStorage.setItem("aftertrace.welcome", status.history?.found ? "found" : "empty")
        nav("/settings?tab=sources", { replace: true })
      } else {
        localStorage.setItem("aftertrace.welcome", "done")
      }
    } catch {
      /* private mode */
    }
  }, [mock, status, loc, nav])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setCmd((v) => !v)
        return
      }
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "g") {
        pendingG.current = Date.now()
        return
      }
      if (Date.now() - pendingG.current < 1200) {
        const hit = JUMP.find((i) => i.key === e.key)
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

  return (
    <StatusContext.Provider value={status}>
      <div className="app">
        <header className="top">
          <div className="left">
            <Link href="/" className="brand">
              <Logo size={22} />
              <b>Aftertrace</b>
            </Link>
          </div>
          <nav className="nav" aria-label="Main">
            {NAV.map((it) => {
              const on = it.match ? it.match(loc) : loc === it.href || loc.startsWith(`${it.href}/`)
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  className={on ? "on side-item" : "side-item"}
                  aria-current={on ? "page" : undefined}
                  title={`${it.label} (g ${it.key})`}
                >
                  {it.label}
                  {it.count && status && status.findings > 0 ? <span className="ct">{status.findings}</span> : null}
                </Link>
              )
            })}
          </nav>
          <div className="right">
            <button type="button" className="search" onClick={() => setCmd(true)}>
              <Search size={14} />
              <span>Search</span>
              <kbd>⌘K</kbd>
            </button>
            <button
              type="button"
              className="iconbtn"
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title="Toggle theme"
              onClick={() => onTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <Link href="/settings" className="iconbtn" aria-label="Settings" title="Settings (g ,)">
              <Settings size={16} />
            </Link>
          </div>
        </header>
        <main className="main">
          <div key={pageKey(loc)} className="page-in">
            {children}
          </div>
        </main>
        {mock ? (
          <div className="sample-tag" data-nc>
            Sample data
          </div>
        ) : null}
      </div>
      <CommandPalette open={cmd} onClose={() => setCmd(false)} onTheme={() => onTheme(theme === "dark" ? "light" : "dark")} />
    </StatusContext.Provider>
  )
}

function pageKey(loc: string): string {
  return loc.split("?")[0]
}
