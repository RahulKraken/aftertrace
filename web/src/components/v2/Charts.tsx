import type { Finding } from "../../lib/types"

function parseDollars(s: string): number[] {
  const out: number[] = []
  const re = /\$([0-9]+(?:\.[0-9]+)?)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) out.push(Number(m[1]))
  return out
}

export function FindingMini({ f, wide = false }: { f: Finding; wide?: boolean }) {
  const w = wide ? 368 : 266
  const h = wide ? 130 : 80
  if (f.rule_id === "model.opus_downgrade") {
    const ds = parseDollars(f.detail || "")
    const opus = ds[0] && ds[0] > 0 ? ds[0] : 0.108
    const son = ds[1] && ds[1] > 0 ? ds[1] : opus / 5
    const max = Math.max(opus, son, 0.001)
    const bw = w - 110
    return (
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`}>
        <text className="tick" x="0" y={wide ? 41 : 22} style={wide ? { fontSize: 13 } : undefined}>
          Opus
        </text>
        <rect x="60" y={wide ? 24 : 10} width={Math.max(8, (opus / max) * bw)} height={wide ? 24 : 16} rx={wide ? 6 : 4} fill="var(--ink)" />
        <text className="tn" x={60 + (opus / max) * bw + 10} y={wide ? 41 : 23} style={wide ? { fontSize: 17 } : undefined}>
          ${opus.toFixed(opus >= 1 ? 2 : 3)}
        </text>
        <text className="tick" x="0" y={wide ? 97 : 62} style={wide ? { fontSize: 13 } : undefined}>
          Sonnet
        </text>
        <rect x="60" y={wide ? 80 : 50} width={Math.max(8, (son / max) * bw)} height={wide ? 24 : 16} rx={wide ? 6 : 4} fill="var(--amber)" />
        <text className="tn" x={60 + (son / max) * bw + 10} y={wide ? 97 : 63} style={wide ? { fontSize: 17 } : undefined}>
          ${son.toFixed(son >= 1 ? 2 : 3)}
        </text>
      </svg>
    )
  }
  if (f.rule_id === "cache.drop_after_compaction") {
    const dropX = wide ? 185 : 153
    return (
      <svg width="100%" height={wide ? 130 : 86} viewBox={`0 0 ${wide ? 368 : 300} ${wide ? 130 : 86}`} preserveAspectRatio="none" style={{ overflow: "visible" }}>
        <line x1="0" y1={wide ? 118 : 78} x2={wide ? 368 : 300} y2={wide ? 118 : 78} stroke="var(--rule)" />
        <path
          d={wide ? "M2 16 L26 14 L50 15 L74 12 L98 14 L122 12 L146 13 L170 11 L182 11 L188 110 L214 107 L240 104 L266 99 L292 95 L318 92 L344 88 L366 86" : "M2 12 L30 10 L58 11 L86 9 L114 10 L142 9 L150 9 L156 74 L184 72 L212 70 L240 66 L268 63 L296 60"}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={wide ? 2.2 : 2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <line x1={dropX} y1="4" x2={dropX} y2={wide ? 118 : 78} stroke="var(--amber)" strokeWidth="1.5" strokeDasharray={wide ? "3 4" : "3 3"} />
        <circle cx={dropX + 3} cy={wide ? 110 : 74} r={wide ? 5 : 4} fill="var(--amber)" />
        <text className="tn" x={wide ? 140 : 104} y={wide ? 38 : 30} style={wide ? { fontSize: 17 } : undefined}>
          96%
        </text>
        <text className="tn" x={wide ? 200 : 164} y={wide ? 100 : 66} style={wide ? { fontSize: 17 } : undefined}>
          4%
        </text>
      </svg>
    )
  }
  if (f.rule_id === "mcp.large_results") {
    const m = (f.headline || "").match(/([\d,]+)\s+tokens/)
    const tokens = m ? Number(m[1].replace(/,/g, "")) : 44000
    const cap = 8000
    const frac = Math.min(0.92, cap / Math.max(tokens, cap))
    const barW = wide ? 368 : 270
    const capW = Math.max(24, barW * frac)
    return (
      <svg width="100%" height={wide ? 130 : 56} viewBox={`0 0 ${barW} ${wide ? 130 : 56}`}>
        <rect x="0" y={wide ? 52 : 22} width={barW} height={wide ? 34 : 26} rx={wide ? 7 : 5} fill="var(--amber-tint)" />
        <rect x="0" y={wide ? 52 : 22} width={capW} height={wide ? 34 : 26} rx={wide ? 7 : 5} fill="var(--ink)" />
        <text className="tn" x="0" y={wide ? 40 : 14} style={wide ? { fontSize: 17 } : undefined}>
          8k
        </text>
        <text className="tn" x={barW} y={wide ? 40 : 14} textAnchor="end" style={wide ? { fontSize: 17 } : undefined}>
          {tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens)}
        </text>
      </svg>
    )
  }
  const v = f.monthly_usd || f.impact_value || 1
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`}>
      <rect x="0" y={h / 2 - 10} width={Math.max(24, w * 0.7)} height="20" rx="5" fill="var(--ink)" />
      <rect x="0" y={h / 2 - 10} width={Math.max(8, w * 0.18)} height="20" rx="5" fill="var(--amber-tint)" />
      <text className="tn" x="8" y={h / 2 - 18}>
        {v >= 1 ? `$${v.toFixed(2)}` : ""}
      </text>
    </svg>
  )
}

export function CompareChart({ f }: { f: Finding }) {
  const ds = parseDollars(f.detail || "")
  const a = ds[0] && ds[0] > 0 ? ds[0] : f.monthly_usd || f.impact_value || 1
  const b = ds[1] && ds[1] > 0 ? ds[1] : a * 0.2
  const max = Math.max(a, b, 0.001)
  const hA = Math.max(16, (a / max) * 250)
  const hB = Math.max(16, (b / max) * 250)
  const pct = a > 0 ? Math.round((1 - b / a) * 100) : 0
  const left = f.rule_id === "model.opus_downgrade" ? "Opus" : "Now"
  const right = f.rule_id === "model.opus_downgrade" ? "Sonnet" : "After"
  return (
    <svg width="100%" height="330" viewBox="0 0 640 330">
      <line x1="0" y1="290" x2="640" y2="290" stroke="var(--rule-2)" />
      <rect x="70" y={290 - hA} width="150" height={hA} rx="8" fill="var(--ink)" />
      <rect x="300" y={290 - hB} width="150" height={hB} rx="8" fill="var(--amber)" />
      <text className="tn" x="145" y={290 - hA - 14} textAnchor="middle" style={{ fontSize: 22 }}>
        ${a.toFixed(2)}
      </text>
      <text className="tn" x="375" y={290 - hB - 14} textAnchor="middle" style={{ fontSize: 22 }}>
        ${b.toFixed(2)}
      </text>
      <text className="tick" x="145" y="316" textAnchor="middle" style={{ fontSize: 14 }}>
        {left}
      </text>
      <text className="tick" x="375" y="316" textAnchor="middle" style={{ fontSize: 14 }}>
        {right}
      </text>
      {pct > 0 ? (
        <>
          <line x1="220" y1={290 - hA} x2="520" y2={290 - hA} stroke="var(--amber)" strokeWidth="1.5" strokeDasharray="3 4" />
          <path d={`M500 ${290 - hA} V${290 - hB}`} stroke="var(--amber)" strokeWidth="2" />
          <text x="522" y={(290 - hA + 290 - hB) / 2} style={{ font: "400 30px var(--serif)", fill: "var(--amber-ink)" }}>
            −{pct}%
          </text>
        </>
      ) : null}
    </svg>
  )
}

export function WeekSpark({ cur, prev }: { cur: number[]; prev: number[] }) {
  const n = Math.max(cur.length, prev.length, 2)
  const max = Math.max(...cur, ...prev, 0.01)
  const pts = (arr: number[]) =>
    arr
      .map((v, i) => {
        const x = 4 + (i / Math.max(n - 1, 1)) * 248
        const y = 8 + (1 - v / max) * 56
        return `${x},${y}`
      })
      .join(" ")
  const last = cur[cur.length - 1] || 0
  const lx = 4 + ((cur.length - 1) / Math.max(n - 1, 1)) * 248
  const ly = 8 + (1 - last / max) * 56
  return (
    <svg width="100%" height="84" viewBox="0 0 256 84" preserveAspectRatio="none">
      {prev.length > 1 ? <polyline points={pts(prev)} fill="none" stroke="var(--rule-2)" strokeWidth="1.5" strokeDasharray="1 5" strokeLinecap="round" /> : null}
      {cur.length > 1 ? <polyline points={pts(cur)} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /> : null}
      <circle cx={lx} cy={ly} r="4" fill="var(--ink)" />
    </svg>
  )
}

export function DailyBars({ cur, prev }: { cur: number[]; prev: number[] }) {
  const days = ["M", "T", "W", "T", "F", "S", "S"]
  const n = 7
  const max = Math.max(...cur, ...prev, 0.01)
  const H = 236
  const items = Array.from({ length: n }, (_, i) => ({
    c: cur[i] || 0,
    p: prev[i] || 0,
    d: days[i],
  }))
  return (
    <svg width="100%" height="266" viewBox="0 0 864 266">
      <line x1="0" y1="236" x2="864" y2="236" stroke="var(--rule-2)" />
      {items.map((it, i) => {
        const x = 40 + i * 120
        const ph = (it.p / max) * H
        const ch = (it.c / max) * H
        return (
          <g key={i}>
            <rect x={x} y={236 - ph} width="34" height={Math.max(2, ph)} rx="5" fill="var(--rule-2)" />
            <rect x={x + 38} y={236 - ch} width="34" height={Math.max(2, ch)} rx="5" fill="var(--ink)" />
            <text className="tick" x={x + 36} y="262" textAnchor="middle" data-nc="1">
              {it.d}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export function TickStrip({ n, label }: { n: number; label: string }) {
  const cols = Math.min(30, Math.max(8, n > 0 ? Math.min(n, 30) : 12))
  const counts: number[] = []
  let h = 2166136261 ^ n
  let left = Math.max(1, n)
  for (let i = 0; i < cols; i++) {
    h = Math.imul(h, 1664525) + 1013904223
    const c = 1 + ((h >>> 0) % 8)
    counts.push(c)
    left -= c
  }
  return (
    <div>
      <div className="lbl">
        <span className="n" style={{ fontSize: 15, color: "var(--ink)" }}>
          {n || counts.reduce((a, b) => a + b, 0)}
        </span>
        &nbsp;{label}
      </div>
      <svg width="100%" height="80" viewBox="0 0 1184 80">
        {counts.map((c, i) =>
          Array.from({ length: Math.min(c, 10) }, (_, r) => (
            <rect key={`${i}-${r}`} x={12.7 + i * 39.5} y={70 - r * 7} width="14" height="5" rx="2" fill="var(--ink-2)" opacity="0.7" />
          )),
        )}
      </svg>
    </div>
  )
}
