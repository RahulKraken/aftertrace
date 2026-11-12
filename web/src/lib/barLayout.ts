// Geometry for timeline bars and the duration · cost labels that sit with them.
// Labels never occupy the name column; bars never shrink below a visible sliver.

export const MIN_BAR_PX = 2
export const TRACK_PAD_RIGHT = 12

export type LabelMode = "after" | "before" | "inside"

const LAB_FACE = '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif'
export const BAR_LAB_FONT = `400 12px ${LAB_FACE}`
export const BAR_LAB_FONT_INSIDE = `600 12px ${LAB_FACE}`

export function barBox(
  leftPct: number,
  widthPct: number,
  trackW: number,
  minPx = MIN_BAR_PX,
): { left: string; width: string; leftPx: number; widthPx: number } {
  if (trackW <= 0) {
    const width = Math.max(widthPct, 0.5)
    return { left: `${leftPct}%`, width: `${width}%`, leftPx: 0, widthPx: 0 }
  }
  const widthPx = Math.max((widthPct / 100) * trackW, minPx)
  const leftPx = Math.min(Math.max(0, (leftPct / 100) * trackW), Math.max(0, trackW - widthPx))
  return { left: `${leftPx}px`, width: `${widthPx}px`, leftPx, widthPx }
}

export function placeBarLabel(opts: {
  barLeft: number
  barWidth: number
  trackW: number
  labelW: number
  insideLabelW?: number
  gap?: number
}): { mode: LabelMode; left: number } {
  const gap = opts.gap ?? 6
  const afterW = Math.max(0, opts.labelW)
  const insideW = Math.max(0, opts.insideLabelW ?? opts.labelW)
  const trackW = Math.max(0, opts.trackW)
  const clamp = (left: number, mode: LabelMode, w: number): { mode: LabelMode; left: number } => ({
    mode,
    left: Math.min(Math.max(0, left), Math.max(0, trackW - w)),
  })
  if (trackW <= 0 || afterW <= 0) return { mode: "after", left: opts.barLeft + opts.barWidth + gap }

  const after = opts.barLeft + opts.barWidth + gap
  if (after + afterW <= trackW + 0.5) return clamp(after, "after", afterW)

  if (opts.barWidth >= insideW + 8) return clamp(opts.barLeft + opts.barWidth - insideW - 4, "inside", insideW)

  const before = opts.barLeft - gap - afterW
  if (before >= -0.5) return clamp(before, "before", afterW)

  if (opts.barWidth > 12) return clamp(opts.barLeft + 4, "inside", insideW)
  return clamp(after, "after", afterW)
}

let labelCanvas: HTMLCanvasElement | null = null

export function measureBarLabel(text: string, font = BAR_LAB_FONT): number {
  if (!text) return 0
  if (typeof document !== "undefined") {
    labelCanvas = labelCanvas || document.createElement("canvas")
    const ctx = labelCanvas.getContext("2d")
    if (ctx) {
      ctx.font = font
      return Math.ceil(ctx.measureText(text).width) + 2
    }
  }
  const em = /600|bold/.test(font) ? 8.2 : 7.4
  return Math.ceil(text.length * em) + 4
}

export function spanExtent(span: { start_ns: number; end_ns: number; duration_ms?: number; kids?: { start_ns: number; end_ns: number; kids?: unknown[] }[] }): {
  start_ns: number
  end_ns: number
} {
  let start = Number.isFinite(span.start_ns) ? span.start_ns : 0
  let end = Number.isFinite(span.end_ns) ? span.end_ns : start
  const walk = (s: { start_ns: number; end_ns: number; kids?: { start_ns: number; end_ns: number; kids?: unknown[] }[] }) => {
    if (Number.isFinite(s.start_ns)) start = Math.min(start, s.start_ns)
    if (Number.isFinite(s.end_ns)) end = Math.max(end, s.end_ns)
    s.kids?.forEach((k) => walk(k as { start_ns: number; end_ns: number; kids?: { start_ns: number; end_ns: number; kids?: unknown[] }[] }))
  }
  walk(span)
  if (end < start) {
    const ms = span.duration_ms || 0
    end = start + ms * 1e6
  }
  return { start_ns: start, end_ns: end }
}
