import { useCallback, useEffect, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { useLocation } from "wouter"
import { api } from "../lib/api"
import type { Finding, Session } from "../lib/types"

type Item = { id: string; group: string; label: string; href?: string; run?: () => void; hint?: string }

export function CommandPalette({ open, onClose, onTheme }: { open: boolean; onClose: () => void; onTheme: () => void }) {
  const [, nav] = useLocation()
  const [q, setQ] = useState("")
  const [i, setI] = useState(0)
  const [sessions, setSessions] = useState<Session[]>([])
  const [findings, setFindings] = useState<Finding[]>([])

  useEffect(() => {
    if (!open) return
    setQ("")
    setI(0)
    api.sessions().then(setSessions).catch(() => undefined)
    api.findings().then(setFindings).catch(() => undefined)
  }, [open])

  const items = useMemo(() => {
    const pages: Item[] = [
      { id: "p-h", group: "Pages", label: "Home", href: "/", hint: "g h" },
      { id: "p-s", group: "Pages", label: "Sessions", href: "/sessions", hint: "g s" },
      { id: "p-a", group: "Pages", label: "Apps", href: "/apps", hint: "g a" },
      { id: "p-f", group: "Pages", label: "Findings", href: "/findings", hint: "g f" },
      { id: "p-c", group: "Pages", label: "Cost", href: "/cost", hint: "g c" },
      { id: "p-p", group: "Pages", label: "Plans", href: "/plans", hint: "g p" },
      { id: "p-q", group: "Pages", label: "Query", href: "/query", hint: "g q" },
      { id: "p-r", group: "Pages", label: "Recap", href: "/recap", hint: "g r" },
      { id: "p-n", group: "Pages", label: "Connect a source", href: "/connect", hint: "g n" },
      { id: "p-x", group: "Pages", label: "Settings", href: "/settings", hint: "g ," },
    ]
    const actions: Item[] = [
      { id: "a-theme", group: "Actions", label: "Toggle light and dark theme", run: onTheme },
      { id: "a-ask", group: "Actions", label: "Ask a question about your data", href: "/query?tab=ask" },
    ]
    // Sessions are titled by their first prompt, so this searches what you asked for.
    const sess: Item[] = sessions.map((s) => ({
      id: `s-${s.session_id}`,
      group: "Sessions",
      label: s.title || `${s.repo || "session"} · ${s.session_id.slice(0, 8)}`,
      href: `/session/${s.session_id}`,
    }))
    const fs: Item[] = findings.map((f) => ({
      id: `f-${f.id}`,
      group: "Findings",
      label: f.headline,
      href: f.evidence[0] ? `/trace/${f.evidence[0].trace_id}?span=${f.evidence[0].span_id}` : "/findings",
    }))
    const all = [...pages, ...actions, ...sess, ...fs]
    const needle = q.toLowerCase().trim()
    if (!needle) return all.slice(0, 12)
    return all.filter((x) => x.label.toLowerCase().includes(needle) || x.group.toLowerCase().includes(needle)).slice(0, 12)
  }, [q, sessions, findings, onTheme])

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
