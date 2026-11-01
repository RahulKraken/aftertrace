import { useCallback, useEffect, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { useLocation } from "wouter"
import { api } from "../lib/api"
import type { Finding, Session } from "../lib/types"
import { shortTitle } from "../lib/welcome"

type Item = { id: string; group: string; label: string; href?: string; run?: () => void; hint?: string }

export function CommandPalette({ open, onClose, onTheme }: { open: boolean; onClose: () => void; onTheme: () => void }) {
  const [, nav] = useLocation()
  const [q, setQ] = useState("")
  const [i, setI] = useState(0)
  const [sessions, setSessions] = useState<Session[]>([])
  const [findings, setFindings] = useState<Finding[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!open) return
    setQ("")
    setI(0)
    setReady(false)
    let alive = true
    Promise.all([api.sessions().catch(() => [] as Session[]), api.findings().catch(() => [] as Finding[])]).then(([s, f]) => {
      if (!alive) return
      setSessions(s)
      setFindings(f)
      setReady(true)
    })
    return () => {
      alive = false
    }
  }, [open])

  const items = useMemo(() => {
    const pages: Item[] = [
      { id: "p-h", group: "Pages", label: "Home", href: "/", hint: "g h" },
      { id: "p-s", group: "Pages", label: "Sessions", href: "/sessions", hint: "g s" },
      { id: "p-a", group: "Pages", label: "Apps", href: "/sessions?src=apps", hint: "g a" },
      { id: "p-f", group: "Pages", label: "Findings", href: "/findings", hint: "g f" },
      { id: "p-c", group: "Pages", label: "Cost", href: "/recap", hint: "g c" },
      { id: "p-q", group: "Pages", label: "Query", href: "/settings?tab=query", hint: "g q" },
      { id: "p-r", group: "Pages", label: "Recap", href: "/recap", hint: "g r" },
      { id: "p-n", group: "Pages", label: "Connect a source", href: "/settings?tab=sources", hint: "g n" },
      { id: "p-x", group: "Pages", label: "Settings", href: "/settings", hint: "g ," },
    ]
    const actions: Item[] = [
      { id: "a-theme", group: "Actions", label: "Toggle light and dark theme", run: onTheme },
      { id: "a-ask", group: "Actions", label: "Ask a question about your data", href: "/settings?tab=query&view=ask" },
    ]
    const sess: Item[] = sessions.map((s) => ({
      id: `s-${s.session_id}`,
      group: "Sessions",
      label: s.title || `${s.repo || "session"} · ${s.session_id.slice(0, 8)}`,
      href: `/session/${s.session_id}`,
    }))
    const fs: Item[] = findings.map((f) => ({
      id: `f-${f.id}`,
      group: "Findings",
      label: shortTitle(f),
      href: `/findings?focus=${f.id}`,
    }))
    const all = [...pages, ...actions, ...sess, ...fs]
    const needle = q.toLowerCase().trim()
    if (!needle) return all.slice(0, 12)
    if (!ready) return []
    return all
      .filter((x) => x.label.toLowerCase().includes(needle) || x.group.toLowerCase().includes(needle))
      .slice(0, 12)
  }, [q, sessions, findings, onTheme, ready])

  useEffect(() => {
    setI(0)
  }, [q])

  const choose = useCallback(
    (item: Item) => {
      if (item.run) item.run()
      else if (item.href) nav(item.href)
      onClose()
    },
    [nav, onClose],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose()
        e.preventDefault()
      } else if (e.key === "ArrowDown") {
        setI((n) => Math.min(items.length - 1, n + 1))
        e.preventDefault()
      } else if (e.key === "ArrowUp") {
        setI((n) => Math.max(0, n - 1))
        e.preventDefault()
      } else if (e.key === "Enter" && items[i]) {
        choose(items[i])
        e.preventDefault()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, items, i, choose, onClose])

  if (!open) return null
  return (
    <div className="cmd-back" onClick={onClose}>
      <div className="cmd" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div className="cmd-in">
          <Search size={15} />
          <input
            autoFocus
            placeholder="Search pages, sessions by prompt, findings, actions"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && items[i]) {
                e.preventDefault()
                e.stopPropagation()
                choose(items[i])
              }
            }}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="cmd-list">
          {items.map((item, idx) => (
            <button
              type="button"
              key={item.id}
              className={idx === i ? "on" : undefined}
              onMouseEnter={() => setI(idx)}
              onClick={() => choose(item)}
            >
              <span className="mute">{item.group}</span>
              <span className="cmd-label">{item.label}</span>
              {item.hint && <kbd>{item.hint}</kbd>}
            </button>
          ))}
          {!items.length && <div className="empty">Nothing matches.</div>}
        </div>
      </div>
    </div>
  )
}
