import { useCallback, useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Check, Wrench } from "lucide-react"
import { Link } from "wouter"
import { WinStage } from "../components/WinStage"
import { dur, impactParts, usd } from "../lib/format"
import { api } from "../lib/api"
import { fixFor, rankHero, type Win } from "../lib/fixes"
import type { Finding } from "../lib/types"
import { onWins, resolveFinding, resolvedIds } from "../lib/wins"

type PendingWin = { win: Win; id: number }

export function FindingsPage() {
  const [fs, setFs] = useState<Finding[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [resolved, setResolved] = useState(() => resolvedIds())
  // #/findings?focus=3 opens with that finding as the hero (Home links here).
  const [focus, setFocus] = useState<number | null>(() => {
    const h = window.location.hash
    const m = /[?&]focus=(\d+)/.exec(h)
    return m ? Number(m[1]) : null
  })
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
      <div className="findings-head">
        <h1>Findings</h1>
        <div className="sub">One change at a time, ranked by what it costs you. Every finding links to the spans behind it.</div>
        {done.length > 0 && <Ledger done={done} />}
      </div>
      <div className="findings-body">
        <AnimatePresence mode="popLayout" initial={false}>
          {hero ? (
            <motion.div
              key={hero.id}
              initial={{ opacity: 0, transform: "translateY(8px)" }}
              animate={{ opacity: 1, transform: "translateY(0px)", transition: { duration: 0.32, ease: [0.23, 1, 0.32, 1] } }}
              exit={{ opacity: 0, transform: "translateY(-6px)", transition: { duration: 0.16, ease: [0.23, 1, 0.32, 1] } }}
            >
              <HeroFinding
                f={hero}
                onFixed={(win) => {
                  const next = { win, id: hero.id }
                  pendingRef.current = next
                  setPending(next)
                }}
                onDone={() => resolveFinding(hero.id)}
              />
            </motion.div>
          ) : (
            <motion.h1 key="none" className="story-line week-line" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              Nothing left to fix.
            </motion.h1>
          )}
        </AnimatePresence>
        {(rest.length > 0 || done.length > 0) && (
          <div className="quiet-list stagger">
            {done.map((f) => (
              <motion.div layout="position" transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }} className="frow quiet resolved" data-finding={f.id} key={`done-${f.id}`}>
                <span className="hl">{f.headline}</span>
                <span className="resolved-mark">resolved</span>
              </motion.div>
            ))}
            {rest.map((f) => {
              const [v, u] = impactParts(f)
              return (
                <motion.button
                  layout="position"
                  transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
                  type="button"
                  className="frow quiet"
                  data-finding={f.id}
                  key={f.id}
                  onClick={() => setFocus(f.id)}
                >
                  <span className="hl">
                    <span className={`pillar pillar-${f.pillar}`}>{f.pillar}</span>
                    {f.headline}
                  </span>
                  <span className="imp">
                    {v}
                    <span>{u}</span>
                  </span>
                </motion.button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// What resolved findings were worth, summed per unit (Norman: feedback;
// emotional design: reflective). Impacts are the rule's own estimates.
function Ledger({ done }: { done: Finding[] }) {
  let secs = 0
  let usdSaved = 0
  for (const f of done) {
    if (f.impact_unit.startsWith("USD")) usdSaved += f.impact_value
    else if (/^s\b|waited|lost|^s /.test(f.impact_unit)) secs += f.impact_value
  }
  const parts = [secs > 0 ? `${dur(secs * 1000)} of waiting` : "", usdSaved > 0 ? `${usd(usdSaved)}` : ""].filter(Boolean)
  return (
    <div className="ledger">
      <Check size={14} />
      <span>
        {done.length} {done.length === 1 ? "finding" : "findings"} resolved
        {parts.length ? <> · worth about {parts.join(" and ")} at the rate they were costing you</> : null}
      </span>
    </div>
  )
}

function HeroFinding({ f, onFixed, onDone }: { f: Finding; onFixed: (win: Win) => void; onDone: () => void }) {
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
      <div className="acts">
        {fx && (
          <button type="button" className="btn fix-btn" onClick={copyFix}>
            {copied ? <Check size={13} /> : <Wrench size={13} />}
            {copied ? "Copied" : `Fix · ${fx.label}`}
          </button>
        )}
        <button type="button" className={`btn ${fx ? "ghost" : ""}`} onClick={onDone}>
          <Check size={13} /> Mark as done
        </button>
      </div>
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
