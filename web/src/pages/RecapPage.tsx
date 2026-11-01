import { useEffect, useState } from "react"
import { Download, ImageIcon, FileText } from "lucide-react"
import { Link } from "wouter"
import { api } from "../lib/api"
import { clock, dur, sayTok, usd } from "../lib/format"
import { readBudget } from "../lib/budget"
import { modelFamily, primaryModel } from "../lib/model"
import { receiptLines, receiptMarkdown, receiptPNG, weekLabel } from "../lib/receipt"
import { useToast } from "../lib/toast"
import type { Recap, Session, SessionDetail } from "../lib/types"
import { ModelChip } from "../components/ModelChip"
import { Money } from "../components/Money"
import { TraceLine } from "../components/TraceLine"
import { Meter } from "../components/Meter"

export function RecapPage() {
  const [week, setWeek] = useState(0)
  const [r, setR] = useState<Recap | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [loud, setLoud] = useState<SessionDetail | null>(null)
  const [budget, setBudget] = useState(() => readBudget()?.weekly ?? null)
  const toast = useToast()

  useEffect(() => {
    const on = () => setBudget(readBudget()?.weekly ?? null)
    window.addEventListener("aftertrace-budget", on)
    return () => window.removeEventListener("aftertrace-budget", on)
  }, [])

  useEffect(() => {
    let alive = true
    api.recap(week).then((x) => alive && setR(x)).catch((e: Error) => alive && setErr(e.message))
    api.sessions().then((ss) => alive && setSessions(ss)).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [week])

  useEffect(() => {
    if (!r || !sessions.length) return
    const inWeek = sessions.filter((s) => s.start_ns >= r.lo && s.start_ns < r.hi)
    const loudest = [...inWeek].sort((a, b) => (b.cost_usd || 0) - (a.cost_usd || 0))[0]
    if (!loudest) {
      setLoud(null)
      return
    }
    api.session(loudest.session_id).then(setLoud).catch(() => setLoud(null))
  }, [r, sessions])

  if (err && !r) return <div className="page">{err}</div>
  if (!r) return <div className="v4"><div className="v4-empty">Loading…</div></div>
  const s = r.stats
  const saved = s.cost_usd < r.prev.cost_usd ? r.prev.cost_usd - s.cost_usd : 0
  const dCost = (r.prev.cost_usd || 0) - s.cost_usd
  const opus = r.models.filter((m) => modelFamily(m.model) === "opus").reduce((a, m) => a + m.cost_usd, 0)
  const opusShare = s.cost_usd > 0 ? opus / s.cost_usd : 0
  const cache = s.cache_hit
  const prevCache = r.prev.cache_hit
  const cacheDelta = cache != null && prevCache != null ? Math.round((cache - prevCache) * 100) : null
  const lines = receiptLines(r, null, false)
  const dark = document.documentElement.dataset.theme === "dark"

  const copyImage = async () => {
    try {
      const blob = await receiptPNG(lines, dark)
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
      toast("Receipt copied as an image")
    } catch {
      toast("Copy failed. Use Download instead.")
    }
  }
  const download = async () => {
    const blob = await receiptPNG(lines, dark)
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `aftertrace-week-${new Date(r.lo / 1e6).toISOString().slice(0, 10)}.png`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const copyMarkdown = async () => {
    await navigator.clipboard.writeText(receiptMarkdown(r, null, false))
    toast("Recap copied as Markdown")
  }

  const days = weekDays(r, sessions)
  const prevDays = prevWeekGhost(r, sessions)

  return (
    <div className="v4 recap">
      <div className="v4-ph">
        <h1>Recap</h1>
        <div className="v4-seg">
          <button type="button" disabled={!r.has_older} onClick={() => setWeek(week + 1)} aria-label="Previous week">‹</button>
          <button type="button" className="on">{weekLabel(r)}</button>
          <button type="button" disabled={week === 0} onClick={() => setWeek(week - 1)} aria-label="Next week">›</button>
        </div>
      </div>
      <div className="v4-hero">
        <div style={{ display: "flex", alignItems: "baseline" }}>
          <span className="v4-num"><Money value={s.cost_usd} /></span>
          <span className="d">
            {dCost !== 0 ? `${dCost > 0 ? "↓" : "↑"} ${usd(Math.abs(dCost))}` : ""}
            {s.tokens ? ` · ${sayTok(s.tokens)} tok` : ""}
          </span>
        </div>
        <div className="r" style={{ display: "flex", gap: 16, alignItems: "center" }}>
          {saved > 0 && <span className="v4-chip">Saved {usd(saved)}</span>}
          <button type="button" className="icon-btn" onClick={copyImage} title="Copy receipt"><ImageIcon size={14} /></button>
          <button type="button" className="icon-btn" onClick={copyMarkdown} title="Markdown"><FileText size={14} /></button>
          <button type="button" className="icon-btn" onClick={download} aria-label="Download PNG"><Download size={14} /></button>
        </div>
      </div>
      <section className="v4-card v4-g4">
        <div>
          <div className="v4-lbl">Daily</div>
          <div className="v" style={{ display: "flex", width: "100%" }}>
            <span className="v4-num"><Money value={s.cost_usd} /></span>
            {budget ? <span className="v4-delta">/ {usd(budget)}</span> : null}
            <span className="v4-when" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
              <i style={{ width: 9, height: 9, border: "1px dashed var(--t3)", borderRadius: 2, display: "inline-block" }} />
              {prevLabel(r)} · {usd(r.prev.cost_usd)}
            </span>
          </div>
          <div className="viz">
            <DailyChart days={days} ghost={prevDays} budget={budget} />
          </div>
        </div>
        <Loudest r={r} loud={loud} />
        <div>
          <div className="v4-lbl">Models</div>
          <div className="v">
            <span className="v4-num">{opusShare > 0 ? `${Math.round(opusShare * 100)}%` : "—"}</span>
            <span className="v4-delta">{usd(opus)} / {usd(s.cost_usd)}</span>
          </div>
          <div>
            <div className="v4-sbar" style={{ height: 8, margin: "20px 0 6px" }}>
              <i style={{ width: `${opusShare * 100}%`, background: "var(--m-opus)" }} />
              <i style={{ flex: 1, background: "var(--m-son)" }} />
            </div>
            {r.models.map((m) => (
              <div className="v4-lr" key={m.model}>
                <span><ModelChip model={m.model} /></span>
                <span className="v4-tk">{sayTok(m.tokens)}</span>
                <span className="v2">{usd(m.cost_usd)}</span>
              </div>
            ))}
            {!r.models.length && <div className="v4-empty">No model spend.</div>}
          </div>
        </div>
        <div>
          <div className="v4-lbl">Cache hit</div>
          <div className="v">
            <span className="v4-num">{cache != null ? `${Math.round(cache * 100)}%` : "—"}</span>
            {cacheDelta != null ? <span className="v4-delta">{cacheDelta >= 0 ? "↑" : "↓"} {Math.abs(cacheDelta)} pts</span> : null}
          </div>
          <div className="viz" style={{ marginTop: 14 }}>
            {cache != null && (
              <div className="v4-pb">
                <div className="top"><span>{weekLabel(r)}</span><span>{Math.round(cache * 100)}%</span></div>
                <Meter fill={cache} />
              </div>
            )}
            {prevCache != null && (
              <div className="v4-pb">
                <div className="top"><span>{prevLabel(r)}</span><span>{Math.round(prevCache * 100)}%</span></div>
                <div className="v4-meter">
                  <div className="v4-trk"><i style={{ width: `${prevCache * 100}%`, background: "var(--bar)" }} /></div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
      <div className="receipt" aria-label="Weekly receipt" style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }}>
        {lines.map((l, i) => (
          <div key={i} className={`rl rl-${l.kind}`}>
            {l.left && <span>{l.left}</span>}
            {l.right && <span>{l.right}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

function Loudest({ r, loud }: { r: Recap; loud: SessionDetail | null }) {
  const t = loud?.session
  const turns = loud?.turns || []
  const vals = turns.map((x) => x.cost_usd || x.duration_ms || 0)
  const peak = vals.length ? Math.max(...vals) : 0
  if (!t && !r.priciest) {
    return (
      <div>
        <div className="v4-lbl">Loudest</div>
        <div className="v4-empty">No runs this week.</div>
      </div>
    )
  }
  const model = t ? primaryModel(t.models) : ""
  const cost = t?.cost_usd ?? r.priciest?.cost_usd ?? 0
  const title = t?.title || "Loudest run"
  return (
    <div>
      <div className="hd">
        <span className="v4-lbl">Loudest</span>
        {model ? <ModelChip model={model} /> : null}
        <span className="v4-when">{t ? clock(t.start_ns) : ""}</span>
      </div>
      <div className="v">
        <span className="v4-num"><Money value={cost} /></span>
        <span className="v4-delta">
          {t ? `${dur(t.turn_ms)} · ${t.turns}× · ${sayTok(t.tokens)} tok` : r.priciest ? dur(r.priciest.duration_ms) : ""}
        </span>
      </div>
      <div className="v4-lt">
        {t ? <Link href={`/session/${t.session_id}`}>{title}</Link> : title}
      </div>
      <div className="viz">
        <TraceLine
          values={vals.length ? vals : [cost]}
          width={500}
          height={130}
          flag
          peak={peak > 0 ? usd(peak) : undefined}
          sw={1.3}
          r={3}
          tail={0.1}
        />
      </div>
    </div>
  )
}

function DailyChart({
  days,
  ghost,
  budget,
}: {
  days: { start_ns: number; cost_usd: number; by_model: { model: string; cost_usd: number }[] }[]
  ghost: number[]
  budget: number | null
}) {
  const w = 480
  const h = 174
  const max = Math.max(...days.map((d) => d.cost_usd), ...ghost, budget ? budget / 7 : 0, 0.01)
  const n = 7
  const gap = w / n
  const labels = ["S", "M", "T", "W", "T", "F", "S"]
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`}>
      <line x1="0" x2={w} y1="150" y2="150" stroke="var(--line)" />
      {budget ? <line x1="0" x2={w} y1={150 - (budget / 7 / max) * 145} y2={150 - (budget / 7 / max) * 145} stroke="var(--t3)" strokeDasharray="3 3" /> : null}
      {days.map((d, i) => {
        const x = 27.6 + i * gap
        const gh = ghost[i] || 0
        const gH = (gh / max) * 145
        const tot = d.by_model.reduce((a, p) => a + p.cost_usd, 0) || d.cost_usd
        const bh = (tot / max) * 145
        let y = 150
        const dow = new Date(d.start_ns / 1e6).getDay()
        return (
          <g key={i}>
            {gH > 0 && <rect x={x} y={150 - gH} width="11" height={gH} rx="1.5" fill="none" stroke="var(--t3)" strokeDasharray="2 2" />}
            {d.by_model.length
              ? [...d.by_model].reverse().map((p) => {
                  const ph = tot > 0 ? bh * (p.cost_usd / tot) : 0
                  y -= ph
                  return (
                    <rect
                      key={p.model}
                      x={x + 15.5}
                      y={y}
                      width="12"
                      height={Math.max(ph, 0)}
                      rx="1.5"
                      fill={modelFamily(p.model) === "opus" ? "var(--m-opus)" : modelFamily(p.model) === "sonnet" ? "var(--m-son)" : "var(--bar)"}
                    />
                  )
                })
              : tot > 0
                ? <rect x={x + 15.5} y={150 - bh} width="12" height={bh} rx="1.5" fill="var(--m-opus)" />
                : null}
            <text className="v4-tick" x={x + 13.5} y="168" textAnchor="middle">{labels[dow]}</text>
          </g>
        )
      })}
    </svg>
  )
}

function weekDays(r: Recap, sessions: Session[]) {
  const out = []
  for (let i = 0; i < 7; i++) {
    const start = r.lo + i * 86400e9
    const end = start + 86400e9
    const ss = sessions.filter((s) => s.start_ns >= start && s.start_ns < end)
    const by = new Map<string, number>()
    let cost = 0
    for (const s of ss) {
      cost += s.cost_usd || 0
      const fam = primaryModel(s.models) || "other"
      by.set(fam, (by.get(fam) || 0) + (s.cost_usd || 0))
    }
    out.push({
      start_ns: start,
      cost_usd: cost,
      by_model: [...by.entries()].map(([model, cost_usd]) => ({ model, cost_usd })),
    })
  }
  return out
}

function prevWeekGhost(r: Recap, sessions: Session[]): number[] {
  const lo = r.lo - 7 * 86400e9
  return Array.from({ length: 7 }, (_, i) => {
    const start = lo + i * 86400e9
    const end = start + 86400e9
    return sessions.filter((s) => s.start_ns >= start && s.start_ns < end).reduce((a, s) => a + (s.cost_usd || 0), 0)
  })
}

function prevLabel(r: Recap): string {
  const a = new Date((r.lo - 7 * 86400e9) / 1e6)
  const b = new Date((r.lo - 1) / 1e6)
  return `${a.getDate()}–${b.getDate()} ${b.toLocaleDateString("en-GB", { month: "short" })}`
}
