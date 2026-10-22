import { mixShare } from "../lib/story"
import type { Breakdown } from "../lib/types"

const FILL: Record<string, string> = {
  model: "var(--hue-model)",
  tool: "var(--hue-tool)",
  permission_wait: "var(--hue-wait)",
  retry: "var(--hue-retry)",
  hook: "var(--hue-hook)",
  other: "var(--hue-turn)",
}

// Same order as mixShare(); permission checks are folded into "other" there.
const KEYS = ["model", "tool", "permission_wait", "retry", "hook", "other"]

export function MiniWaterfall({ bd, turns = 4 }: { bd: Breakdown | null | undefined; turns?: number }) {
  const share = mixShare(bd)
  const n = Math.max(2, Math.min(turns, 8))
  return (
    <svg className="mini-wf" viewBox="0 0 72 22" width="72" height="22" aria-hidden>
      {share.map((s, i) => {
        const x = share.slice(0, i).reduce((a, b) => a + b, 0) * 72
        const w = Math.max(s * 72, s > 0 ? 1.2 : 0)
        if (!w) return null
        return <rect key={KEYS[i]} className="mwf-seg" style={{ ["--i" as string]: i }} x={x} y={4} width={w} height="10" rx="1.5" fill={FILL[KEYS[i]]} />
      })}
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={(i / n) * 70 + 1} y="16" width={Math.max(4, 70 / n - 2)} height="3" rx="1" fill="currentColor" opacity={0.18 + (i % 3) * 0.08} />
      ))}
    </svg>
  )
}
