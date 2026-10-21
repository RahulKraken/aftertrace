import { CAT_LABEL, CATS, dur } from "../lib/format"
import type { Breakdown } from "../lib/types"

export function SplitBar({ bd, width = 148 }: { bd: Breakdown | null | undefined; width?: number }) {
  if (!bd) return null
  const tot = CATS.reduce((a, c) => a + (bd[c] || 0), 0) || 1
  const title = CATS.map((c) => `${CAT_LABEL[c]} ${dur(bd[c])}`).join(" · ")
  return (
    <div className="split" style={{ width }} title={title}>
      {CATS.map((c) => (
        <i key={c} className={`c-${c}`} style={{ width: `${((bd[c] || 0) / tot) * 100}%` }} />
      ))}
    </div>
  )
}

export function Legend() {
  return (
    <div className="legend">
      {CATS.map((c) => (
        <span key={c}>
          <i className={`c-${c}`} />
          {CAT_LABEL[c]}
        </span>
      ))}
    </div>
  )
}
