export const REPLAY_SPEED = 4

/** Axis ceilings Flo used, then the next quiet steps for longer turns. */
export const AXIS_BUCKETS_MS = [20_000, 30_000, 60_000, 120_000, 180_000, 300_000, 600_000]

/** Rescale before the playhead hits the right edge (~12% headroom). */
export function liveAxisMs(elapsedMs: number, totalMs: number): number {
  if (elapsedMs >= totalMs - 16) return totalMs
  for (const bucket of AXIS_BUCKETS_MS) {
    if (elapsedMs < bucket * 0.88) return Math.min(bucket, totalMs)
  }
  return totalMs
}

export function tickLabel(ms: number): string {
  if (ms <= 0) return "0"
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) {
    const s = ms / 1000
    return Number.isInteger(s) ? `${s}s` : `${s.toFixed(1)}s`
  }
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return s ? `${m}m ${s}s` : `${m}m`
}

export function hashFlag(name: string): boolean {
  if (typeof window === "undefined") return false
  const h = window.location.hash || ""
  const q = h.includes("?") ? h.slice(h.indexOf("?") + 1) : ""
  const search = (window.location.search || "").replace(/^\?/, "")
  return new URLSearchParams(q || search).get(name) === "1"
}
