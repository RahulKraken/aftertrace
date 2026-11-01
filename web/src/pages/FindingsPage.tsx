import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowRight, Check } from "lucide-react"
import { Link, useLocation } from "wouter"
import { WinStage } from "../components/WinStage"
import { CompareChart, FindingMini, TickStrip } from "../components/v2/Charts"
import { copyText } from "../lib/copy"
import { usd } from "../lib/format"
import { api } from "../lib/api"
import { fixFor, rankHero, type Win } from "../lib/fixes"
import { useHashQuery } from "../lib/hash"
import { monthlyUSD, shortTitle } from "../lib/welcome"
import type { Finding } from "../lib/types"
import { findingKey, onWins, resolveFinding, resolvedKeys } from "../lib/wins"

type PendingWin = { win: Win; finding: Finding }

export function FindingsPage() {
  const [fs, setFs] = useState<Finding[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [resolved, setResolved] = useState(() => resolvedKeys())
  const q = useHashQuery()
  const [, nav] = useLocation()
  const [focus, setFocus] = useState<number | null>(() => {
    const m = /[?&]focus=(\d+)/.exec(window.location.hash)
    return m ? Number(m[1]) : null
  })
  const [pending, setPending] = useState<PendingWin | null>(null)
  const pendingRef = useRef<PendingWin | null>(null)

  useEffect(() => {
    const n = q.get("focus")
    setFocus(n ? Number(n) : null)
  }, [q])

  useEffect(() => {
    api.findings().then(setFs).catch((e: Error) => setErr(e.message))
  }, [])

  useEffect(() => onWins(() => setResolved(resolvedKeys())), [])

  const finishWin = useCallback(() => {
    const cur = pendingRef.current
    if (cur) resolveFinding(cur.finding)
    pendingRef.current = null
    setPending(null)
    setFocus(null)
    nav("/findings")
  }, [nav])

  if (err) {
    return <div className="v2">{err}</div>
  }
  if (!fs) return <div className="v2 mute">…</div>
  if (!fs.length) {
    return (
      <div className="v2">
        <h1 className="sr-only">Findings</h1>
        <div className="find-v2">
          <div className="hd">
            <div className="tot">
              $0<small>/mo</small>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const open = fs.filter((f) => !resolved.has(findingKey(f)))
  const order = [...resolved]
  const done = fs
    .filter((f) => resolved.has(findingKey(f)))
    .sort((a, b) => order.indexOf(findingKey(b)) - order.indexOf(findingKey(a)))
  const ranked = [...open].sort((a, b) => {
    const ma = monthlyUSD(a)
    const mb = monthlyUSD(b)
    if (mb !== ma) return mb - ma
    return (b.impact_value || 0) - (a.impact_value || 0)
  })
  const hero = ranked.find((f) => f.id === focus) || (focus != null ? open.find((f) => f.id === focus) : null)

  if (hero) {
    return (
      <div className={`v2 fd-v2${pending ? " is-win" : ""}`}>
        {pending && <WinStage win={pending.win} onDone={finishWin} />}
        <h1 className="sr-only">Findings</h1>
        <Detail
          f={hero}
          onBack={() => {
            setFocus(null)
            nav("/findings")
          }}
          onFixed={(win) => {
            const next = { win, finding: hero }
            pendingRef.current = next
            setPending(next)
          }}
          onDone={() => {
            resolveFinding(hero)
            setFocus(null)
            nav("/findings")
          }}
        />
      </div>
    )
  }

  const money = ranked.filter((f) => monthlyUSD(f) > 0)
  const big = (money.length ? money : ranked).slice(0, 3)
  const small = [...ranked.filter((f) => !big.includes(f)), ...done]
  const total = ranked.reduce((a, f) => a + monthlyUSD(f), 0)
  const bar = big.map((f) => monthlyUSD(f)).concat([small.filter((f) => !done.includes(f)).reduce((a, f) => a + monthlyUSD(f), 0)].filter((n) => n > 0))
  const ambers = ["#E29A2E", "#EBB565", "#F1CC94", "var(--rule-2)"]

  return (
    <div className="v2 find-v2">
      <h1 className="sr-only">Findings</h1>
      <section className="hd">
        <div className="tot">
          {usd(total)}
          <small>/mo</small>
        </div>
        <div className="stack">
          <div className="bar">
            {bar.map((n, i) => (
              <i key={i} style={{ flex: n || 0.01, background: ambers[i] || "var(--rule-2)" }} />
            ))}
          </div>
          <div className="ax">
            {bar.map((n, i) => (
              <span key={i} style={{ flex: n || 0.01 }}>
                {usd(n)}
              </span>
            ))}
          </div>
        </div>
      </section>
      <section className="big">
        {big.map((f) => (
          <button type="button" key={f.id} className="vcard next-card" data-finding={f.id} onClick={() => openFocus(f.id, setFocus, nav)}>
            <div className="viz">
              <FindingMini f={f} wide />
            </div>
            <div className="ttl">{shortTitle(f)}</div>
            <div className="row2">
              <div className="amt">
                {usd(monthlyUSD(f))}
                <small>/mo</small>
              </div>
              <span className="btn quiet ico">
                <ArrowRight size={15} />
              </span>
            </div>
          </button>
        ))}
      </section>
      <section className="small">
        {small.map((f) => {
          const resolvedRow = done.includes(f)
          const moneyN = monthlyUSD(f)
          const time = !moneyN && (f.impact_unit.includes("s ") || f.impact_unit.startsWith("s") || /wait|lost|min/.test(f.impact_unit))
          return (
            <button
              type="button"
              key={f.id}
              className={`tile frow ${resolvedRow ? "resolved" : "quiet"}${time ? " time" : ""}`}
              data-finding={f.id}
              onClick={() => !resolvedRow && openFocus(f.id, setFocus, nav)}
            >
              <span className="ic">
                <TileIcon rule={f.rule_id} />
              </span>
              <div className="tt">{shortTitle(f)}</div>
              <div className="ta n">
                {moneyN > 0 ? (
                  <>
                    {usd(moneyN)}
                    <small>/mo</small>
                  </>
                ) : time ? (
                  <>
                    {Math.max(1, Math.round(f.impact_value / 60))}
                    <small> min</small>
                  </>
                ) : (
                  <>{Math.round(f.impact_value)}</>
                )}
              </div>
            </button>
          )
        })}
      </section>
      {/* rankHero keeps a stable pick if tests ever land without a click */}
      <span hidden>{rankHero(open)?.id}</span>
    </div>
  )
}

function openFocus(id: number, setFocus: (n: number) => void, nav: (to: string) => void) {
  setFocus(id)
  nav(`/findings?focus=${id}`)
}

function Detail({
  f,
  onBack,
  onFixed,
  onDone,
}: {
  f: Finding
  onBack: () => void
  onFixed: (win: Win) => void
  onDone: () => void
}) {
  const fx = fixFor(f)
  const [copied, setCopied] = useState(false)
  const monthly = monthlyUSD(f)
  const copyFix = async () => {
    if (!fx) return
    await copyText(fx.snippet)
    setCopied(true)
    onFixed(fx.win)
    window.setTimeout(() => setCopied(false), 1600)
  }
  return (
    <div className="frow hero" data-finding={f.id}>
      <button type="button" className="back" onClick={onBack} aria-label="Back">
        <ArrowRight size={15} style={{ transform: "rotate(180deg)" }} />
      </button>
      <section className="g">
        <div className="evbox">
          {f.rule_id === "model.opus_downgrade" ? <CompareChart f={f} /> : <FindingMini f={f} wide />}
        </div>
        <div className="fd-side">
          <div>
            <h1>{shortTitle(f)}</h1>
            <div className="amt">
              {monthly > 0 ? (
                <>
                  {usd(monthly)}
                  <small>/mo</small>
                </>
              ) : (
                <>{Math.max(1, Math.round(f.impact_value / 60))}<small> min</small></>
              )}
            </div>
          </div>
          <div className="fix">
            {fx ? (
              <pre className="code fix-preview" data-nc>
                {fx.snippet}
              </pre>
            ) : null}
            <div className="acts">
              {fx ? (
                <button type="button" className="btn primary fix-btn" onClick={copyFix}>
                  {copied ? <Check size={13} /> : <CopyIcon />}
                  {copied ? "Copied" : "Copy fix"}
                </button>
              ) : null}
              <button type="button" className="btn" onClick={onDone}>
                Done
              </button>
            </div>
          </div>
        </div>
      </section>
      <section className="strip">
        <TickStrip n={Math.max(f.evidence.length, f.sessions.length)} label={shortTitle(f).toLowerCase()} />
      </section>
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

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  )
}

function TileIcon({ rule }: { rule: string }) {
  const p = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, width: 18, height: 18 }
  if (rule.includes("retry")) return <svg {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
  if (rule.includes("switch")) return <svg {...p}><path d="M17 3l4 4-4 4" /><path d="M3 7h18" /><path d="M7 21l-4-4 4-4" /><path d="M21 17H3" /></svg>
  if (rule.includes("skill") || rule.includes("plugin")) return <svg {...p}><path d="M12 3 2 8l10 5 10-5-10-5z" /><path d="M2 16l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
  if (rule.includes("error") || rule.includes("bash") || rule.includes("tool")) return <svg {...p}><path d="M4 17l6-6-6-6" /><path d="M12 19h8" /></svg>
  if (rule.includes("permission")) return <svg {...p}><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M8 12.5l3 3 5-6" /></svg>
  if (rule.includes("hook")) return <svg {...p}><path d="M12 3v10a4 4 0 1 1-8 0" /><circle cx="12" cy="3" r="1" /><path d="M16 9h5M18.5 6.5v5" /></svg>
  if (rule.includes("app.errors") || rule.includes("rate")) return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
  return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
}
