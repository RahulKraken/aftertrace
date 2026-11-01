import { useCallback, useEffect, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"
import { Link } from "wouter"
import { WinStage } from "../components/WinStage"
import { ModelChip } from "../components/ModelChip"
import { Money } from "../components/Money"
import { sayDur, usd } from "../lib/format"
import { api } from "../lib/api"
import { fixFor, rankHero, type Win } from "../lib/fixes"
import { moneyLabel, monthlyUSD, shortTitle } from "../lib/welcome"
import type { Finding, ModelSpend } from "../lib/types"
import { findingKey, onWins, resolveFinding, resolvedKeys } from "../lib/wins"

type PendingWin = { win: Win; finding: Finding }

const AMBER = ["var(--amber)", "var(--a2)", "var(--a3)", "var(--a4)"]

export function FindingsPage() {
  const [fs, setFs] = useState<Finding[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [resolved, setResolved] = useState(() => resolvedKeys())
  const [focus, setFocus] = useState<number | null>(() => {
    const h = window.location.hash
    const m = /[?&]focus=(\d+)/.exec(h)
    return m ? Number(m[1]) : null
  })
  const [pending, setPending] = useState<PendingWin | null>(null)
  const pendingRef = useRef<PendingWin | null>(null)
  const [models, setModels] = useState<ModelSpend[]>([])
  const [spend, setSpend] = useState(0)

  useEffect(() => {
    api.findings().then(setFs).catch((e: Error) => setErr(e.message))
    api.cost("model").then((c) => {
      const mi = c.columns.indexOf("model")
      const ci = c.columns.indexOf("cost_usd")
      const rows = (c.rows || []).map((r) => ({ model: String(r[mi] ?? ""), cost_usd: Number(r[ci] || 0) }))
      setModels(rows)
      setSpend(rows.reduce((a, r) => a + r.cost_usd, 0))
    }).catch(() => undefined)
  }, [])

  useEffect(() => onWins(() => setResolved(resolvedKeys())), [])

  const finishWin = useCallback(() => {
    const cur = pendingRef.current
    if (cur) resolveFinding(cur.finding)
    pendingRef.current = null
    setPending(null)
    setFocus(null)
  }, [])

  const copyFix = useCallback(async (f: Finding) => {
    const fx = fixFor(f)
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
    const next = { win: fx.win, finding: f }
    pendingRef.current = next
    setPending(next)
  }, [])

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === "INPUT" || tag === "TEXTAREA") return
        const open = (fs || []).filter((f) => !resolved.has(findingKey(f)))
        const hero = open.find((f) => f.id === focus) || rankHero(open)
        if (hero && fixFor(hero)) {
          e.preventDefault()
          copyFix(hero)
        }
      }
    }
    window.addEventListener("keydown", on)
    return () => window.removeEventListener("keydown", on)
  }, [fs, focus, resolved, copyFix])

  if (err) {
    return (
      <div className="page">
        {err}
        <div className="err-next">Reload. If it persists, check that the mock fixtures loaded.</div>
      </div>
    )
  }
  if (!fs) return <div className="v4"><div className="v4-empty">Loading…</div></div>

  const open = fs.filter((f) => !resolved.has(findingKey(f)))
  const order = [...resolved]
  const done = fs
    .filter((f) => resolved.has(findingKey(f)))
    .sort((a, b) => order.indexOf(findingKey(b)) - order.indexOf(findingKey(a)))
  const money = open.filter((f) => f.impact_unit.startsWith("USD")).sort((a, b) => monthlyUSD(b) - monthlyUSD(a))
  const time = open.filter((f) => !f.impact_unit.startsWith("USD"))
  const hero = open.find((f) => f.id === focus) || rankHero(open)
  const moneyTotal = money.reduce((a, f) => a + monthlyUSD(f), 0)
  const timeTotal = time.reduce((a, f) => a + f.impact_value, 0)
  const maxMoney = Math.max(...money.map((f) => monthlyUSD(f)), 1e-9)
  const maxTime = Math.max(...time.map((f) => f.impact_value), 1e-9)

  return (
    <div className={`v4 split findings-page${pending ? " is-win" : ""}`}>
      {pending && <WinStage win={pending.win} onDone={finishWin} />}
      <div className="v4-l">
        <div className="v4-ph">
          <h1>Findings</h1>
        </div>
        {!fs.length ? (
          <section className="v4-card v4-empty">All quiet.</section>
        ) : (
          <>
            <section className="v4-card">
              <div className="v4-tbl">
                <div className="v4-gh"><span /><span className="v4-num">{usd(moneyTotal)} /mo</span></div>
                {money.map((f, i) => (
                  <FindRow
                    key={f.id}
                    f={f}
                    color={AMBER[Math.min(i, 3)]}
                    sel={hero?.id === f.id}
                    value={usd(monthlyUSD(f))}
                    width={(monthlyUSD(f) / maxMoney) * 100}
                    onClick={() => setFocus(f.id)}
                  />
                ))}
                {time.length > 0 && (
                  <>
                    <div className="v4-hr" />
                    <div className="v4-gh"><span /><span className="v4-num">{sayDur(timeTotal * 1000)} /mo</span></div>
                    {time.map((f) => (
                      <FindRow
                        key={f.id}
                        f={f}
                        color="var(--t3)"
                        sel={hero?.id === f.id}
                        value={sayDur(f.impact_value * 1000)}
                        width={(f.impact_value / maxTime) * 100}
                        onClick={() => setFocus(f.id)}
                      />
                    ))}
                  </>
                )}
                {done.map((f) => (
                  <FindRow
                    key={`d-${f.id}`}
                    f={f}
                    color="var(--t3)"
                    sel={false}
                    value="done"
                    width={8}
                    resolved
                    onClick={() => setFocus(f.id)}
                  />
                ))}
              </div>
            </section>
            <section className="v4-card v4-wh">
              {models.map((m) => (
                <div className="rw" key={m.model}>
                  <ModelChip model={m.model} />
                  <div className="b">
                    <i style={{ width: `${spend > 0 ? (m.cost_usd / spend) * 100 : 0}%`, background: modelFill(m.model) }} />
                  </div>
                  <span className="v">{usd(m.cost_usd)}</span>
                </div>
              ))}
              {moneyTotal > 0 && spend > 0 && (
                <div className="rw">
                  <span className="v4-lbl" style={{ color: "var(--amber-ink)" }}>Savable</span>
                  <div className="b">
                    <i className="v4-hatch" style={{ width: `${(moneyTotal / spend) * 100}%` }} />
                  </div>
                  <span className="v" style={{ color: "var(--amber-ink)" }}>{usd(moneyTotal)}</span>
                </div>
              )}
              <div className="ax"><span>$0</span><span>{usd(spend)}</span></div>
            </section>
          </>
        )}
      </div>
      <FindingPane
        f={hero}
        index={hero ? open.findIndex((x) => x.id === hero.id) + 1 : 0}
        total={open.length}
        spend={spend}
        onCopy={() => hero && copyFix(hero)}
        onDone={() => hero && resolveFinding(hero)}
      />
    </div>
  )
}

function FindRow({
  f,
  color,
  sel,
  value,
  width,
  resolved,
  onClick,
}: {
  f: Finding
  color: string
  sel: boolean
  value: string
  width: number
  resolved?: boolean
  onClick: () => void
}) {
  const ev = evidenceLabel(f)
  return (
    <button
      type="button"
      className={`v4-fr frow${sel ? " sel hero" : ""}${resolved ? " resolved quiet" : " quiet"}`}
      data-finding={f.id}
      onClick={onClick}
    >
      <span className="v4-dot" style={{ background: color }} />
      <span className="nm">{shortTitle(f)}</span>
      <span className="ev">{ev || ""}</span>
      <span className="trk"><i style={{ width: `${Math.max(width, 4)}%`, background: color }} /></span>
      <span className="v" style={color.startsWith("var(--amber") || color.startsWith("var(--a") ? { color: "var(--amber-ink)" } : undefined}>{value}</span>
    </button>
  )
}

function FindingPane({
  f,
  index,
  total,
  spend,
  onCopy,
  onDone,
}: {
  f: Finding | null
  index: number
  total: number
  spend: number
  onCopy: () => void
  onDone: () => void
}) {
  const fx = f ? fixFor(f) : null
  const money = f && f.impact_unit.startsWith("USD")
  const monthly = f && money ? monthlyUSD(f) : 0
  if (!f) {
    return (
      <aside className="v4-pane">
        <div className="v4-ph"><span className="sub">0 / {total}</span></div>
        <div className="v4-empty">Nothing left to fix.</div>
      </aside>
    )
  }
  const ticks = Math.min(Math.max(f.evidence.length || f.sessions.length || 8, 8), 48)
  return (
    <aside className="v4-pane">
      <div className="v4-ph">
        <span className="sub">{index} / {total || 1}</span>
        {fx ? (
          <button type="button" className="v4-btn pri fix-btn" title="Copy fix" onClick={onCopy}>
            <Copy size={14} />
            <kbd>⌘C</kbd>
          </button>
        ) : (
          <button type="button" className="v4-btn" onClick={onDone}>
            <Check size={13} /> Done
          </button>
        )}
      </div>
      <div className="frow hero" data-finding={f.id}>
        <h2>{shortTitle(f)}</h2>
        <div className={`v4-big v4-money${money ? "" : " neutral"}`}>
          {money ? <Money value={monthly} /> : sayDur(f.impact_value * 1000)}
          {money ? <small>/mo</small> : null}
        </div>
        {f.money_label || moneyLabel(f, "") ? <p className="found-save" style={{ display: "none" }}>{f.money_label || moneyLabel(f, "")}</p> : null}
        <div className="v4-cmp">
          {money && spend > 0 && (
            <div className="r">
              <div className="top"><span className="v4-lbl">This</span><span className="v4-money">{usd(monthly)}</span></div>
              <div className="b"><i className="v4-hatch" style={{ width: `${Math.min(100, (monthly / Math.max(spend, monthly)) * 100)}%` }} /></div>
            </div>
          )}
        </div>
        <div className="v4-strip">
          {Array.from({ length: ticks }, (_, i) => <i key={i} />)}
        </div>
        <div className="v4-sl">
          <span>{f.sessions.length ? `${f.sessions.length} sessions` : `${f.evidence.length} spans`}</span>
          <span>{f.estimated ? "est." : ""}</span>
        </div>
        {fx && <pre className="v4-code fix-preview">{fx.snippet}</pre>}
        <div className="evs">
          {f.evidence.slice(0, 6).map((e, i) => (
            <Link key={i} className="ev" href={`/trace/${e.trace_id}?span=${e.span_id}`} data-span={e.span_id}>
              {e.label}
            </Link>
          ))}
        </div>
        {!fx ? (
          <button type="button" className="v4-btn pri" style={{ marginTop: 18, alignSelf: "flex-start" }} onClick={onDone}>
            <Check size={13} /> Done
          </button>
        ) : null}
      </div>
    </aside>
  )
}

function evidenceLabel(f: Finding): string {
  const m = f.headline.match(/(\d+)\s+(permission prompts|turns|requests|sessions)/i)
  if (m) return `${m[1]}×`
  if (f.sessions.length > 1) return `${f.sessions.length}×`
  return ""
}

function modelFill(id: string): string {
  const s = id.toLowerCase()
  if (s.includes("opus")) return "var(--m-opus)"
  if (s.includes("sonnet")) return "var(--m-son)"
  return "var(--bar)"
}
