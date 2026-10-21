import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"
import { Link, useLocation } from "wouter"
import type { Theme } from "../lib/theme"
import { CommandPalette } from "./CommandPalette"

const NAV = [
  { href: "/", label: "Sessions" },
  { href: "/findings", label: "Findings" },
  { href: "/query", label: "Query" },
  { href: "/cost", label: "Cost" },
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setCmd((v) => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  return (
    <>
      <header className="top">
        <Link href="/" className="brand">
          aftertrace
          <small>local</small>
        </Link>
        <nav className="tabs">
          {NAV.map((n) => (
            <NavLink key={n.href} {...n} />
          ))}
        </nav>
        <span className="spacer" />
        {mock && <span className="tag warn">synthetic</span>}
        <button
          type="button"
          className="icon-btn"
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          onClick={() => onTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </header>
      <main>{children}</main>
      <CommandPalette open={cmd} onClose={() => setCmd(false)} />
    </>
  )
}

function NavLink({ href, label }: { href: string; label: string }) {
  const [loc] = useLocation()
  const on =
    href === "/"
      ? loc === "/" || loc.startsWith("/session/") || loc.startsWith("/trace/")
      : loc === href || loc.startsWith(`${href}/`)
  return (
    <Link href={href} className={on ? "on" : undefined}>
      {label}
    </Link>
  )
}
