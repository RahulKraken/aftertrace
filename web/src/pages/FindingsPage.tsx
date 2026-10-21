import { useCallback, useEffect, useRef, useState } from "react"
import { Check, Wrench } from "lucide-react"
import { Link } from "wouter"
import { WinStage } from "../components/WinStage"
import { impactParts } from "../lib/format"
import { api } from "../lib/api"
import { fixFor, rankHero, type Win } from "../lib/fixes"
import type { Finding } from "../lib/types"
import { onWins, resolveFinding, resolvedIds } from "../lib/wins"

type PendingWin = { win: Win; id: number }

export function FindingsPage() {
  const [fs, setFs] = useState<Finding[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [resolved, setResolved] = useState(() => resolvedIds())
  const [focus, setFocus] = useState<number | null>(null)
  const [pending, setPending] = useState<PendingWin | null>(null)
  const pendingRef = useRef<PendingWin | null>(null)

  useEffect(() => {
    api.findings().then(setFs).catch((e: Error) => setErr(e.message))
  }, [])

  useEffect(() => onWins(() => setResolved(resolvedIds())), [])

  const finishWin = useCallback(() => {
    const cur = pendingRef.current
    if (cur) resolveFinding(cur.id)
    pendingRef.current = null
    setPending(null)
    setFocus(null)
  }, [])

  if (err) {
    return (
      <div className="page">
        {err}
        <div className="err-next">Reload. If it persists, check that the mock fixtures loaded.</div>
      </div>
    )
  }
  if (!fs) return <div className="page mute">Loading findings…</div>
  if (!fs.length) {
    return (
      <div className="page" style={{ maxWidth: 720 }}>
        <h1>Findings</h1>
        <div className="story-line">All quiet. No rules fired on this machine.</div>
      </div>
    )
  }

  const open = fs.filter((f) => !resolved.has(f.id))
  const order = [...resolved]
  const done = fs
    .filter((f) => resolved.has(f.id))
    .sort((a, b) => order.indexOf(b.id) - order.indexOf(a.id))
  const hero = open.find((f) => f.id === focus) || rankHero(open)
  const rest = open.filter((f) => f.id !== hero?.id)

  return (
    <div className={`page findings-page${pending ? " is-win" : ""}`} style={{ maxWidth: 820 }}>
      {pending && <WinStage win={pending.win} onDone={finishWin} />}
      <div className="findings-body">
        {hero ? (
          <HeroFinding
            f={hero}
            onFixed={(win) => {
              const next = { win, id: hero.id }
              pendingRef.current = next
              setPending(next)
            }}
          />
        ) : (
          <h1 className="story-line week-line">Nothing left to fix.</h1>
        )}
        {(rest.length > 0 || done.length > 0) && (
          <div className="quiet-list">
            {done.map((f) => (
              <div className="frow quiet resolved" data-finding={f.id} key={`done-${f.id}`}>
                <span className="hl">{f.headline}</span>
                <span className="resolved-mark">resolved</span>
              </div>
            ))}
            {rest.map((f) => {
              const [v, u] = impactParts(f)
              return (
                <button type="button" className="frow quiet" data-finding={f.id} key={f.id} onClick={() => setFocus(f.id)}>
                  <span className="hl">{f.headline}</span>
                  <span className="imp">
                    {v}
                    <span>{u}</span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function HeroFinding({ f, onFixed }: { f: Finding; onFixed: (win: Win) => void }) {
  const [v, u] = impactParts(f)
  const fx = fixFor(f)
  const [copied, setCopied] = useState(false)

  const copyFix = async () => {
    if (!fx) return
    try {
      await navigator.clipboard.writeText(fx.snippet)
    } catch {
      const ta = document.createElement("textarea")
      ta.value = fx.snippet
      document.body.appendChild(ta)
      ta.select()
      document.execCommand("copy")
      ta.remove()
    }
    setCopied(true)
    onFixed(fx.win)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="frow hero" data-finding={f.id}>
      <div className="pill-row">
        <span className={`pill ${f.severity}`}>{f.severity}</span>
      </div>
      <h1>{f.headline}</h1>
      <div className="imp hero-imp">
        {v}
        <span>{u}</span>
      </div>
      <p className="rec">{f.recommendation}</p>
      {fx && <pre className="fix-preview">{fx.snippet}</pre>}
      {fx && (
        <div className="acts">
          <button type="button" className="btn fix-btn" onClick={copyFix}>
            {copied ? <Check size={13} /> : <Wrench size={13} />}
            {copied ? "Copied" : `Fix · ${fx.label}`}
          </button>
        </div>
      )}
      <div className="evs">
        {f.evidence.map((e, i) => (
          <Link key={i} className="ev" href={`/trace/${e.trace_id}?span=${e.span_id}`} data-span={e.span_id}>
            {e.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
