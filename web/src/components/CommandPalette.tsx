import { useEffect, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { useLocation } from "wouter"
import { api } from "../lib/api"
import type { Finding, Session } from "../lib/types"

type Item = { id: string; group: string; label: string; href: string }

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
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
      { id: "p-s", group: "Pages", label: "Sessions", href: "/" },
      { id: "p-f", group: "Pages", label: "Findings", href: "/findings" },
      { id: "p-q", group: "Pages", label: "Query", href: "/query" },
      { id: "p-c", group: "Pages", label: "Cost", href: "/cost" },
    ]
    const sess: Item[] = sessions.map((s) => ({
      id: `s-${s.session_id}`,
      group: "Sessions",
      label: `${s.repo || "session"} · ${s.session_id.slice(0, 8)}`,
      href: `/session/${s.session_id}`,
    }))
    const fs: Item[] = findings.map((f) => ({
      id: `f-${f.id}`,
      group: "Findings",
      label: f.headline,
      href: f.evidence[0] ? `/trace/${f.evidence[0].trace_id}?span=${f.evidence[0].span_id}` : "/findings",
    }))
    const all = [...pages, ...sess, ...fs]
    const needle = q.toLowerCase().trim()
    if (!needle) return all.slice(0, 12)
    return all.filter((x) => x.label.toLowerCase().includes(needle) || x.group.toLowerCase().includes(needle)).slice(0, 12)
  }, [q, sessions, findings])

  useEffect(() => {
    setI(0)
  }, [q])

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
        nav(items[i].href)
        onClose()
        e.preventDefault()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, items, i, nav, onClose])

  if (!open) return null
  return (
    <div className="cmd-back" onClick={onClose}>
      <div className="cmd" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div className="cmd-in">
          <Search size={15} />
          <input
            autoFocus
            placeholder="Go to a page, session, or finding"
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
              onClick={() => {
                nav(item.href)
                onClose()
              }}
            >
              <span className="mute">{item.group}</span>
              {item.label}
            </button>
          ))}
          {!items.length && <div className="empty">Nothing matches.</div>}
        </div>
      </div>
    </div>
  )
}
