import { useEffect, useRef, useState } from "react"
import { ArrowRight, Plug } from "lucide-react"
import { Link, useLocation } from "wouter"
import { api } from "../lib/api"
import { copyText } from "../lib/copy"
import { usd } from "../lib/format"
import { fixFor } from "../lib/fixes"
import { layoutTreemap, spendBlocks, type TmBlock } from "../lib/treemap"
import { HOME_MIN_MONTHLY, monthlyUSD, shortTitle } from "../lib/welcome"
import type { CostTable, Finding, Overview } from "../lib/types"
import { FindingMini, WeekSpark } from "../components/v2/Charts"

export function HomePage() {
  const [ov, setOv] = useState<Overview | null>(null)
  const [model, setModel] = useState<CostTable | null>(null)
  const [skill, setSkill] = useState<CostTable | null>(null)
  const [mcp, setMcp] = useState<CostTable | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const live = Boolean(ov?.live.length)

  useEffect(() => {
    let alive = true
    const load = () =>
      Promise.all([api.overview(), api.cost("model"), api.cost("skill").catch(() => null), api.cost("mcp").catch(() => null)])
        .then(([o, m, s, c]) => {
          if (!alive) return
          setOv(o)
          setModel(m)
          setSkill(s)
          setMcp(c)
          setErr(null)
        })
        .catch((e: Error) => alive && setErr(e.message))
    load()
    const t = window.setInterval(load, live ? 4000 : 30000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [live])

  if (err && !ov) {
    return (
      <div className="v2">
        {err}
      </div>
    )
  }
  if (!ov) return <HomeSkeleton />
  if (!ov.has_data) return <FirstRun />

  const sav = ov.savings
  const total = sav?.total_monthly || 0
  const observed = sav?.observed_monthly || ov.week.cost_usd || 0
  const shown = sav?.shown || []
  const lean = total < HOME_MIN_MONTHLY
  const items = spendBlocks(model, skill, mcp, shown)
  const week = ov.days.slice(-7).map((d) => d.cost_usd)
  const prev = ov.days.slice(-14, -7).map((d) => d.cost_usd)
  const delta = ov.prev.cost_usd ? ov.week.cost_usd - ov.prev.cost_usd : 0

  return (
    <div className={`v2 home-v2${lean ? " is-lean" : ""}`}>
      <section className="r1">
        <div className="hero">
          <div className="lbl">
            <span className="dot" />
            Savable
          </div>
          <h1 className="home-story huge">
            {hugeUsd(total)}
            <small>/mo</small>
          </h1>
          <div className="of">
            <span className="vchip" style={{ background: "transparent", padding: 0, color: "var(--ink-3)" }}>
              <span data-nc>of</span>&nbsp;
              <span className="n" style={{ fontSize: 20, color: "var(--ink-2)" }}>
                {usd(observed || ov.week.cost_usd)}
              </span>
            </span>
            {sav && sav.folded > 0 ? (
              <Link href="/findings" className="vchip">
                +{sav.folded} more&nbsp;
                <span className="n" style={{ fontSize: 15 }}>
                  {usd(sav.folded_monthly || 0)}
                </span>
              </Link>
            ) : null}
          </div>
        </div>
        <Treemap items={items} />
      </section>

      {!lean && (
        <section className="r2">
          {shown.map((f) => (
            <FindCard key={f.id} f={f} />
          ))}
          <article className="vcard wk">
            <div className="lbl">This week</div>
            <div className="viz">
              <WeekSpark cur={week} prev={prev} />
            </div>
            <div className="row2" style={{ marginTop: 10 }}>
              <div className="amt">{usd(ov.week.cost_usd)}</div>
              {Math.abs(delta) >= 0.01 ? (
                <span className="n" style={{ color: delta < 0 ? "var(--good)" : "var(--ink-3)", fontSize: 17 }}>
                  {delta < 0 ? "−" : "+"}${Math.abs(delta).toFixed(2)}
                </span>
              ) : null}
            </div>
          </article>
        </section>
      )}
    </div>
  )
}

function hugeUsd(n: number): string {
  if (!(n > 0)) return "$0"
  if (n < 1) return `$${n.toFixed(2)}`
  return `$${Math.round(n)}`
}

function Treemap({ items }: { items: ReturnType<typeof spendBlocks> }) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 720, h: 360 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 720, h: el.clientHeight || 360 }))
    ro.observe(el)
    setSize({ w: el.clientWidth || 720, h: el.clientHeight || 360 })
    return () => ro.disconnect()
  }, [])
  const blocks = layoutTreemap(items, size.w, size.h)
  return (
    <div className="tm" ref={ref} style={{ height: 360 }}>
      {blocks.map((b, i) => (
        <TmCell key={b.id} b={b} dark={i === 0} />
      ))}
    </div>
  )
}

function TmCell({ b, dark }: { b: TmBlock; dark: boolean }) {
  const frac = b.spend > 0 ? Math.min(1, b.save / b.spend) : 0
  const loud = frac >= 0.45
  const small = b.h < 90 || b.w < 110
  return (
    <div
      className={`b${dark ? " dk" : ""}`}
      style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
      title={`${b.label} ${usd(b.spend)}${b.save > 0 ? ` · savable ${usd(b.save)}` : ""}`}
    >
      {frac > 0.02 ? <div className="s" style={{ height: `${frac * 100}%` }} /> : null}
      <span className={`l${loud ? " oa" : ""}`}>{b.label}</span>
      <span className={`v${loud ? " oa" : ""}`} style={small ? { fontSize: 17, top: "auto", bottom: 8 } : undefined}>
        {usd(b.spend)}
      </span>
      {b.save > 0.005 ? <span className="sv">{usd(b.save)}</span> : null}
    </div>
  )
}

function FindCard({ f }: { f: Finding }) {
  const [, nav] = useLocation()
  const fx = fixFor(f)
  const monthly = typeof f.monthly_usd === "number" ? f.monthly_usd : monthlyUSD(f)
  const copyFix = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!fx) {
      nav(`/findings?focus=${f.id}`)
      return
    }
    await copyText(fx.snippet)
    nav(`/findings?focus=${f.id}`)
  }
  return (
    <Link href={`/findings?focus=${f.id}`} className="vcard next-card">
      <div className="viz">
        <FindingMini f={f} />
      </div>
      <div className="ttl">{shortTitle(f)}</div>
      <div className="row2">
        <div className="amt">
          {usd(monthly)}
          <small>/mo</small>
        </div>
        {fx ? (
          <button type="button" className="btn primary fix-btn" onClick={copyFix}>
            <CopyIcon />
            Fix
          </button>
        ) : (
          <span className="btn ico" aria-hidden="true">
            <ArrowRight size={15} />
          </span>
        )}
      </div>
    </Link>
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

function FirstRun() {
  return (
    <div className="v2">
      <div className="first-run">
        <div className="fr-mark">
          <Plug size={18} />
        </div>
        <h1>No sessions yet</h1>
        <Link href="/settings?tab=sources" className="btn primary">
          Connect <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  )
}

function HomeSkeleton() {
  return (
    <div className="v2 home-v2" aria-busy="true">
      <section className="r1">
        <div className="hero">
          <div className="lbl">
            <span className="dot" />
            Savable
          </div>
          <div className="huge home-story">
            $0<small>/mo</small>
          </div>
        </div>
      </section>
    </div>
  )
}
