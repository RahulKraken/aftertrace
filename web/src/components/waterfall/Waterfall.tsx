import { AnimatePresence, motion } from "motion/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "wouter"
import { bottleneckFor } from "../../lib/bottleneck"
import { dur, niceTicks, usd, wallClock } from "../../lib/format"
import { hueVar } from "../../lib/hue"
import { hashFlag, tickLabel } from "../../lib/replay"
import {
  ancestors,
  callCount,
  compactionEvents,
  costOf,
  costUntil,
  defaultCollapsed,
  buildForest,
  errorCount,
  hasError,
  labelOf,
  rollup,
  spanKind,
  visibleRows,
  waitChild,
  type SpanNode,
} from "../../lib/span"
import { turnStory } from "../../lib/story"
import { indexContent, snippet, type ContentIndex } from "../../lib/content"
import type { Finding, Trace } from "../../lib/types"
import { useReplay } from "../../hooks/useReplay"
import { barClass, glyphClass, SpanIcon } from "../SpanIcon"
import { IconLegend } from "../IconLegend"
import { DetailPane } from "./DetailPane"
import { SpanPopover } from "./SpanPopover"
import { TREE_DEPTH, TREE_PAD, TreeConnectors } from "./TreeConnectors"

const ROW = 32
const PANE_KEY = "aftertrace-pane-w"
const LAB_KEY = "aftertrace-lab-w"
const PANE_MIN = 320
const LAB_MIN = 180
// The waterfall keeps at least this much room when the pane grows.
const MAIN_MIN = 420

function readPx(key: string, fallback: number | null): number | null {
  try {
    const v = Number(window.localStorage.getItem(key))
    return Number.isFinite(v) && v > 0 ? v : fallback
  } catch {
    return fallback
  }
}

function writePx(key: string, v: number | null) {
  try {
    if (v == null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, String(Math.round(v)))
  } catch {
    // Storage can be blocked. Width just resets next time.
  }
}

// Pointer drag with body-level cursor and no text selection while it runs.
function startDrag(e: React.PointerEvent, onMove: (dx: number) => void, onEnd: () => void) {
  e.preventDefault()
  const x0 = e.clientX
  document.body.classList.add("is-col-resize")
  const move = (ev: PointerEvent) => onMove(ev.clientX - x0)
  const up = () => {
    document.body.classList.remove("is-col-resize")
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", up)
    onEnd()
  }
  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", up)
}
export type MetricMode = "time" | "cost"

export function Waterfall({
  trace,
  findings,
  initialSpan,
  replay: replayProp,
}: {
  trace: Trace
  findings: Finding[]
  initialSpan?: string | null
  replay?: boolean
}) {
  const { root, byId } = useMemo(() => buildForest(trace.spans), [trace])
  const mark = useMemo(() => bottleneckFor(trace, findings), [trace, findings])
  const wantReplay = replayProp ?? hashFlag("replay")
  const t0 = root.start_ns
  const t1 = root.end_ns
  const fullMs = Math.max((t1 - t0) / 1e6, 1)
  const { live, nowMs, axisMs, restart } = useReplay(fullMs, wantReplay)
  const nowNs = t0 + nowMs * 1e6

  const [collapsed, setCollapsed] = useState(() => {
    const c = defaultCollapsed(root)
    const open = [initialSpan, mark?.spanId].filter(Boolean) as string[]
    for (const id of open) {
      if (!byId.has(id)) continue
      for (const a of ancestors(byId, id)) c.delete(a)
      c.delete(id)
    }
    return c
  })
  const [sel, setSel] = useState(initialSpan && byId.has(initialSpan) ? initialSpan : root.span_id)
  const [paneOpen, setPaneOpen] = useState(() => Boolean(initialSpan && byId.has(initialSpan)))
  const [hoverX, setHoverX] = useState<number | null>(null)
  const [hoverNs, setHoverNs] = useState<number | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [metric, setMetric] = useState<MetricMode>("time")
  const scroller = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const labRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [trackW, setTrackW] = useState(0)
  const [labW, setLabW] = useState(0)
  const [paneW, setPaneW] = useState(() => readPx(PANE_KEY, 520) as number)
  const [labPx, setLabPx] = useState<number | null>(() => readPx(LAB_KEY, null))
  const wfRef = useRef<HTMLDivElement>(null)
  const content = useMemo(() => indexContent(trace), [trace])
  const [view, setView] = useState<{ lo: number; hi: number } | null>(null)
  const [brush, setBrush] = useState<{ a: number; b: number } | null>(null)
  const [flash, setFlash] = useState(false)
  const brushDrag = useRef<{ start: number } | null>(null)
  const mmDrag = useRef<{ x: number; lo: number; hi: number } | null>(null)

  const liveHi = t0 + axisMs * 1e6
  const lo = live ? t0 : (view?.lo ?? t0)
  const hi = live ? liveHi : (view?.hi ?? t1)
  const total = Math.max((hi - lo) / 1e6, 1)

  // Reset when a different trace or span is requested. A running trace is
  // re-fetched every few seconds; that must not wipe selection or expansion.
  const resetKey = `${trace.trace_id}:${initialSpan || ""}:${mark?.spanId || ""}`
  const lastReset = useRef(resetKey)
  useEffect(() => {
    if (lastReset.current === resetKey) return
    lastReset.current = resetKey
    const c = defaultCollapsed(root)
    const open = [initialSpan, mark?.spanId].filter(Boolean) as string[]
    for (const id of open) {
      if (!byId.has(id)) continue
      for (const a of ancestors(byId, id)) c.delete(a)
      c.delete(id)
    }
    setCollapsed(c)
    setSel(initialSpan && byId.has(initialSpan) ? initialSpan : root.span_id)
    setView(null)
    setPaneOpen(Boolean(initialSpan && byId.has(initialSpan)))
    if (initialSpan && byId.has(initialSpan)) {
      setFlash(true)
      window.setTimeout(() => setFlash(false), 900)
    }
  }, [resetKey, initialSpan, root, byId, mark?.spanId])

  const rows = useMemo(() => visibleRows(root, collapsed, live ? nowNs : Number.POSITIVE_INFINITY), [root, collapsed, live, nowNs])
  const selected = byId.get(sel) || root
  const hoverSpan = hoverId ? byId.get(hoverId) : undefined

  const xOf = useCallback((ns: number) => ((ns - lo) / 1e6 / total) * 100, [lo, total])
  const fullX = useCallback((ns: number) => ((ns - t0) / 1e6 / fullMs) * 100, [t0, fullMs])

  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const trk = body.querySelector(".ruler .trk") as HTMLElement | null
    const lab = labRef.current
    const measure = () => {
      if (trk) setTrackW(trk.clientWidth)
      if (lab) setLabW(lab.clientWidth)
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (trk) ro.observe(trk)
    if (lab) ro.observe(lab)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const i = rows.findIndex((r) => r.span.span_id === sel)
    if (i < 0) return
    const top = i * ROW
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const behavior: ScrollBehavior = reduce ? "auto" : "smooth"
    if (top < el.scrollTop) el.scrollTo({ top, behavior })
    else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTo({ top: top - el.clientHeight + ROW * 3, behavior })
  }, [sel, rows])

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const jumpTo = useCallback(
    (id: string) => {
      if (!byId.has(id)) return
      setCollapsed((prev) => {
        const n = new Set(prev)
        for (const a of ancestors(byId, id)) n.delete(a)
        n.delete(id)
        return n
      })
      setSel(id)
      setPaneOpen(true)
      setFlash(true)
      window.setTimeout(() => setFlash(false), 900)
    },
    [byId],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      const i = rows.findIndex((r) => r.span.span_id === sel)
      if (e.key === "j" || e.key === "ArrowDown") {
        if (i < rows.length - 1) setSel(rows[i + 1].span.span_id)
        e.preventDefault()
      } else if (e.key === "k" || e.key === "ArrowUp") {
        if (i > 0) setSel(rows[i - 1].span.span_id)
        e.preventDefault()
      } else if (e.key === "h" || e.key === "ArrowLeft") {
        setCollapsed((p) => new Set(p).add(sel))
        e.preventDefault()
      } else if (e.key === "l" || e.key === "ArrowRight") {
        setCollapsed((p) => {
          const n = new Set(p)
          n.delete(sel)
          return n
        })
        e.preventDefault()
      } else if (e.key === "Enter") {
        setPaneOpen(true)
        e.preventDefault()
      } else if (e.key === "Escape") {
        setPaneOpen(false)
        e.preventDefault()
      } else if (e.key === "[" && trace.prev) {
        location.hash = `#/trace/${trace.prev}`
      } else if (e.key === "]" && trace.next) {
        location.hash = `#/trace/${trace.next}`
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [rows, sel, trace.prev, trace.next])

  const comps = compactionEvents(trace)
  const ticks = niceTicks(total)
  const showMinimap = !live && (view != null || rows.length > 50)
  const errors = errorCount(trace.spans, live ? nowNs : Number.POSITIVE_INFINITY)
  const calls = callCount(trace.spans, live ? nowNs : Number.POSITIVE_INFINITY)
  const sumCost = live ? costUntil(root, nowNs) : rollup(root).cost
  const hoverRow = hoverId ? rows.findIndex((r) => r.span.span_id === hoverId) : -1
  const markHost = mark ? hostRow(mark.spanId, rows, byId) : null

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget.querySelector(".ruler .trk") as HTMLElement | null
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (e.clientX < rect.left) {
      setHoverX(null)
      setHoverNs(null)
      return
    }
    const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width)
    setHoverX(x)
    setHoverNs(lo + (x / rect.width) * (hi - lo))
  }

  const pctToNs = (p: number) => lo + (p / 100) * (hi - lo)
  const commitBrush = (a: number, b: number) => {
    const left = Math.min(a, b)
    const right = Math.max(a, b)
    if (right - left < 1.5) {
      setBrush(null)
      return
    }
    setView({ lo: pctToNs(left), hi: pctToNs(right) })
    setBrush(null)
  }

  const playPct = live ? xOf(nowNs) : null

  return (
    <div
      ref={wfRef}
      className={`wf ${paneOpen ? "has-pane" : ""} ${live ? "is-live" : ""}`}
      style={labPx ? ({ ["--labw" as string]: `${labPx}px` } as React.CSSProperties) : undefined}
    >
      <div className="wf-main">
        <div className="wf-head">
          <div className="crumbs">
            <Link href="/">Sessions</Link> ›{" "}
            <Link href={`/session/${trace.session_id}`} className="mono">
              {trace.session_id.slice(0, 8)}
            </Link>{" "}
            › Turn {trace.turn_index} of {trace.turn_count}
            <span className="spacer" />
            <span className={`live-badge ${live || trace.in_progress ? "is-live" : "is-done"}`}>
              {live || trace.in_progress ? <i className="live-dot" /> : null}
              {live ? "Live" : trace.in_progress ? "Running" : "Done"}
            </span>
            <button type="button" className="replay-btn" onClick={restart} hidden={live}>
              Replay
            </button>
            <div className="seg seg-metric" role="tablist" aria-label="Row metric">
              <button type="button" role="tab" aria-selected={metric === "time"} className={metric === "time" ? "on" : ""} onClick={() => setMetric("time")}>
                Time
              </button>
              <button type="button" role="tab" aria-selected={metric === "cost"} className={metric === "cost" ? "on" : ""} onClick={() => setMetric("cost")}>
                Cost
              </button>
            </div>
            <button className="navbtn" disabled={!trace.prev} onClick={() => (location.hash = `#/trace/${trace.prev}`)} title="[">
              ‹
            </button>
            <button className="navbtn" disabled={!trace.next} onClick={() => (location.hash = `#/trace/${trace.next}`)} title="]">
              ›
            </button>
          </div>
          <h1 className="story-line" style={{ margin: "8px 0 0" }}>
            {turnStory(trace)}
          </h1>
          <div className="wf-sum">
            {dur(live ? nowMs : root.duration_ms)} · {usd(sumCost)} · {calls} calls
            {errors > 0 ? (
              <>
                {" · "}
                <button
                  type="button"
                  className="sum-err"
                  title="Jump to the next error"
                  onClick={() => {
                    const errs = trace.spans.filter((x) => x.is_error).sort((a, b) => a.start_ns - b.start_ns)
                    const cur = errs.findIndex((x) => x.span_id === sel)
                    const next = errs[(cur + 1) % errs.length]
                    if (next) jumpTo(next.span_id)
                  }}
                >
                  {errors} error{errors === 1 ? "" : "s"}
                </button>
              </>
            ) : null}
          </div>
          {showMinimap && (
          <div className="minimap" title="Scrub the turn. Double-click to reset zoom.">
            <div
              className="mm-trk"
              onDoubleClick={() => setView(null)}
              onPointerDown={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                const p = (e.clientX - rect.left) / rect.width
                const span = hi - lo
                const center = t0 + p * (t1 - t0)
                let nlo = center - span / 2
                let nhi = center + span / 2
                if (nlo < t0) {
                  nhi += t0 - nlo
                  nlo = t0
                }
                if (nhi > t1) {
                  nlo -= nhi - t1
                  nhi = t1
                }
                mmDrag.current = { x: e.clientX, lo, hi }
                setView({ lo: Math.max(t0, nlo), hi: Math.min(t1, nhi) })
                ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
              }}
              onPointerMove={(e) => {
                if (!mmDrag.current) return
                const rect = e.currentTarget.getBoundingClientRect()
                const dx = (e.clientX - mmDrag.current.x) / rect.width
                const shift = dx * (t1 - t0)
                let nlo = mmDrag.current.lo + shift
                let nhi = mmDrag.current.hi + shift
                if (nlo < t0) {
                  nhi += t0 - nlo
                  nlo = t0
                }
                if (nhi > t1) {
                  nlo -= nhi - t1
                  nhi = t1
                }
                setView({ lo: nlo, hi: nhi })
              }}
              onPointerUp={() => {
                mmDrag.current = null
              }}
            >
              {root.kids.map((k) => (
                <i
                  key={k.span_id}
                  className={`mm-bar ${barClass(k)}`}
                  style={{
                    left: `${fullX(k.start_ns)}%`,
                    width: `${Math.max(fullX(k.end_ns) - fullX(k.start_ns), 0.4)}%`,
                    background: hueVar(k),
                  }}
                />
              ))}
              <div
                className="mm-view"
                style={{ left: `${fullX(lo)}%`, width: `${Math.max(fullX(hi) - fullX(lo), 2)}%` }}
              />
            </div>
          </div>
          )}
        </div>
        <div
          className="wf-body"
          ref={bodyRef}
          onMouseMove={onMove}
          onMouseLeave={() => {
            setHoverX(null)
            setHoverNs(null)
            setHoverId(null)
          }}
        >
          <div
            className="lab-resizer"
            title="Drag to resize. Double-click to reset."
            onDoubleClick={() => {
              setLabPx(null)
              writePx(LAB_KEY, null)
            }}
            onPointerDown={(e) => {
              const main = bodyRef.current?.getBoundingClientRect()
              if (!main) return
              const w0 = labW || main.width * 0.32
              let last = w0
              startDrag(
                e,
                (dx) => {
                  last = Math.max(LAB_MIN, Math.min(main.width - 200, w0 + dx))
                  setLabPx(last)
                },
                () => writePx(LAB_KEY, last),
              )
            }}
          />
          <div className="ruler">
            <div className="lab" ref={labRef}>
              <IconLegend />
            </div>
            <div
              className="trk"
              onDoubleClick={() => !live && setView(null)}
              onPointerDown={(e) => {
                if (live) return
                const rect = e.currentTarget.getBoundingClientRect()
                const p = ((e.clientX - rect.left) / rect.width) * 100
                brushDrag.current = { start: p }
                setBrush({ a: p, b: p })
                ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
              }}
              onPointerMove={(e) => {
                if (!brushDrag.current) return
                const rect = e.currentTarget.getBoundingClientRect()
                const p = ((e.clientX - rect.left) / rect.width) * 100
                setBrush({ a: brushDrag.current.start, b: p })
              }}
              onPointerUp={(e) => {
                if (!brushDrag.current) return
                const rect = e.currentTarget.getBoundingClientRect()
                const p = ((e.clientX - rect.left) / rect.width) * 100
                commitBrush(brushDrag.current.start, p)
                brushDrag.current = null
              }}
            >
              {ticks.map((t) => (
                <span key={t} className="tick" style={{ left: `${(t / total) * 100}%` }}>
                  {tickLabel(t)}
                </span>
              ))}
              {comps.map((c, i) => (
                <span key={i} className="comp-mark" style={{ left: `${xOf(c.ts_ns)}%` }} title="compaction" />
              ))}
              {hoverX != null && hoverNs != null && (
                <>
                  <div className="crosshair" style={{ left: hoverX }} />
                  <div className="crosshair-label" style={{ left: hoverX }}>
                    {dur((hoverNs - t0) / 1e6)} · {wallClock(hoverNs)}
                  </div>
                </>
              )}
              {playPct != null && <div className="playhead" style={{ left: `${playPct}%` }} />}
              {brush && (
                <div
                  className="brush"
                  style={{
                    left: `${Math.min(brush.a, brush.b)}%`,
                    width: `${Math.abs(brush.b - brush.a)}%`,
                  }}
                >
                  <i className="brush-handle" style={{ left: 0 }} />
                  <i className="brush-handle" style={{ left: "100%" }} />
                </div>
              )}
            </div>
          </div>
          <div
            className="rows"
            ref={scroller}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            onMouseLeave={() => setHoverId(null)}
          >
            <motion.div
              className="rows-inner"
              animate={{ height: rows.length * ROW }}
              transition={{ type: "spring", bounce: 0.14, visualDuration: 0.34 }}
              style={{ position: "relative" }}
            >
              <div className="trk-grid" style={{ left: labW || undefined }}>
                {ticks.map((t) => (
                  <i key={t} style={{ left: `${(t / total) * 100}%` }} />
                ))}
              </div>
              <div className="tree-layer">
                <TreeConnectors rows={rows} rowH={ROW} />
              </div>
              {hoverX != null && (
                <div
                  className="crosshair"
                  style={{ left: `calc(var(--labw) + ${hoverX}px)`, top: 0, height: rows.length * ROW }}
                />
              )}
              {playPct != null && (
                <div
                  className="playhead"
                  style={{ left: (labW || 0) + (playPct / 100) * trackW, top: 0, height: rows.length * ROW }}
                />
              )}
              <AnimatePresence initial={false}>
                {rows.map(({ span, depth }, idx) => (
                  <Row
                    key={span.span_id}
                    span={span}
                    depth={depth}
                    index={idx}
                    selected={paneOpen && sel === span.span_id}
                    flash={flash && paneOpen && sel === span.span_id}
                    collapsed={collapsed.has(span.span_id)}
                    hovered={hoverId === span.span_id}
                    xOf={xOf}
                    trackW={trackW}
                    nowNs={live ? nowNs : null}
                    metric={metric}
                    content={content}
                    mark={mark && markHost === span.span_id ? mark.label : null}
                    markLeft={
                      mark && markHost === span.span_id && byId.get(mark.spanId)
                        ? barBox(xOf(byId.get(mark.spanId)!.start_ns), 0, trackW).left
                        : null
                    }
                    onToggle={() => toggle(span.span_id)}
                    onSelect={(id) => {
                      setSel(id)
                      setPaneOpen(true)
                    }}
                    onHover={setHoverId}
                    onMark={() => mark && jumpTo(mark.spanId)}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          </div>
          <SpanPopover
            content={content}
            span={hoverSpan && !(paneOpen && hoverSpan.span_id === sel) ? hoverSpan : null}
            running={Boolean(hoverSpan && live && hoverSpan.end_ns > nowNs)}
            top={hoverRow >= 0 ? 24 + hoverRow * ROW - scrollTop + ROW + 2 : 0}
            left={(labW || 280) + 12}
          />
        </div>
      </div>
      {paneOpen && (
        <div className="pane-col" style={{ width: paneW }}>
          <div
            className="pane-resizer"
            title="Drag to resize. Double-click to reset."
            onDoubleClick={() => {
              setPaneW(520)
              writePx(PANE_KEY, null)
            }}
            onPointerDown={(e) => {
              const total = wfRef.current?.getBoundingClientRect().width || window.innerWidth
              const w0 = paneW
              let last = w0
              startDrag(
                e,
                (dx) => {
                  last = Math.max(PANE_MIN, Math.min(total - MAIN_MIN, w0 - dx))
                  setPaneW(last)
                },
                () => writePx(PANE_KEY, last),
              )
            }}
          />
          <DetailPane
            node={selected}
            trace={trace}
            findings={findings}
            content={content}
            onSelect={(id) => setSel(id)}
            onClose={() => setPaneOpen(false)}
          />
        </div>
      )}
    </div>
  )
}

const MIN_BAR_PX = 4

function barBox(leftPct: number, widthPct: number, trackW: number): { left: string; width: string } {
  if (trackW <= 0) {
    return { left: `${leftPct}%`, width: `${Math.max(widthPct, 0.5)}%` }
  }
  const leftPx = (leftPct / 100) * trackW
  const widthPx = Math.max((widthPct / 100) * trackW, MIN_BAR_PX)
  const left = Math.min(Math.max(0, leftPx), Math.max(0, trackW - widthPx))
  return { left: `${left}px`, width: `${widthPx}px` }
}

function hostRow(spanId: string, rows: { span: SpanNode }[], byId: Map<string, SpanNode>): string | null {
  const visible = new Set(rows.map((r) => r.span.span_id))
  let cur: string | null = spanId
  while (cur) {
    if (visible.has(cur)) return cur
    cur = byId.get(cur)?.parent_span_id || null
  }
  return null
}

function Row({
  span,
  depth,
  index,
  selected,
  flash,
  collapsed,
  hovered,
  xOf,
  trackW,
  nowNs,
  metric,
  content,
  mark,
  markLeft,
  onToggle,
  onSelect,
  onHover,
  onMark,
}: {
  span: SpanNode
  depth: number
  index: number
  selected: boolean
  flash?: boolean
  collapsed: boolean
  hovered: boolean
  xOf: (ns: number) => number
  trackW: number
  nowNs: number | null
  metric: MetricMode
  content: ContentIndex
  mark: string | null
  markLeft: string | null
  onToggle: () => void
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
  onMark: () => void
}) {
  const k = spanKind(span)
  const label = labelOf(span)
  const name = label.name
  // A turn reads better as what you asked than as "153 chars".
  const target = k === "turn" && content.prompt ? snippet(content.prompt, 120) : label.target
  const kids = span.kids.length
  const ro = collapsed && kids ? rollup(span) : null
  const endNs = nowNs != null ? Math.min(span.end_ns, nowNs) : span.end_ns
  const L = xOf(span.start_ns)
  const W = Math.max(xOf(endNs) - L, 0)
  const wait = waitChild(span)
  // Red means this span failed, or the wait/run step folded into its bar did.
  // A failure further down shows as a dot on the collapsed row, not a red turn.
  const err =
    span.is_error ||
    span.kids.some((c) => {
      const ck = spanKind(c)
      return (ck === "run" || ck === "wait") && c.is_error
    })
  const hiddenErr = !err && collapsed && hasError(span)
  const a = span.attrs
  const attempt = Number(a.attempt || 0)
  const box = barBox(L, W, trackW)
  const shownMs = Math.max(0, (endNs - span.start_ns) / 1e6)
  const cost = costOf(span)
  const met = metric === "cost" ? (cost ? usd(cost) : "—") : dur(shownMs)

  const onBarClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (wait) {
      const trk = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
      const x = ((e.clientX - trk.left) / trk.width) * 100
      const waitEnd = xOf(wait.end_ns)
      if (x >= L && x <= waitEnd) {
        onSelect(wait.span_id)
        return
      }
    }
    onSelect(span.span_id)
  }

  return (
    <motion.div
      className={`row ${selected ? "sel" : ""} ${err ? "err" : ""} ${flash ? "flash" : ""} ${hovered ? "hov" : ""}`}
      data-span={span.span_id}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0, top: index * ROW }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ type: "spring", bounce: 0.16, visualDuration: 0.32 }}
      style={{ position: "absolute", left: 0, right: 0, height: ROW }}
      onClick={() => onSelect(span.span_id)}
      onMouseEnter={() => onHover(span.span_id)}
    >
      <div className="lab">
        <span className="tree-pad" style={{ width: TREE_PAD + depth * TREE_DEPTH }} />
        {kids ? (
          <span
            className="caret"
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
          >
            {collapsed ? "▸" : "▾"}
          </span>
        ) : (
          <span className="caret" />
        )}
        <span className={`glyph ${glyphClass(span)}`}>
          <SpanIcon span={span} />
        </span>
        <span className="name">
          {name}
          {attempt > 1 ? <span className="badge">×{attempt}</span> : null}
          {target ? <span className="t">{target}</span> : null}
        </span>
        <AnimatePresence>
          {ro ? (
            <motion.span
              className="n-pill"
              key="n"
              initial={{ opacity: 0, scale: 0.84 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.84 }}
              transition={{ type: "spring", bounce: 0.22, visualDuration: 0.28 }}
            >
              +{ro.n}
            </motion.span>
          ) : null}
        </AnimatePresence>
        {hiddenErr ? <span className="err-dot" title="An error inside this span" /> : null}
        <span className="met">{met}</span>
      </div>
      <div className="trk">
        <div
          className={`bar ${k === "wait" ? "is-wait" : ""} ${err ? "err" : ""}`}
          style={{ ...box, ["--bar-hue" as string]: hueVar(span) }}
          onClick={onBarClick}
        >
          <Phases span={span} />
        </div>
        {mark ? (
          <button
            type="button"
            className="bn-mark"
            style={{ left: markLeft || box.left }}
            onClick={(e) => {
              e.stopPropagation()
              onMark()
            }}
            title="Open this finding's evidence"
          >
            {mark}
          </button>
        ) : null}
      </div>
    </motion.div>
  )
}

function Phases({ span }: { span: SpanNode }) {
  const k = spanKind(span)
  const a = span.attrs
  const spanNs = span.end_ns - span.start_ns || 1
  const segw = (a0: number, a1: number) => Math.max(0, ((a1 - a0) / spanNs) * 100)
  if (k === "model") {
    if (span.is_error) return <i className="ph-retry" style={{ width: "100%" }} />
    const rs = span.retry_end_ns
    const st = rs || span.start_ns
    const tt = a.ttft_ms ? Math.min(span.end_ns, st + Number(a.ttft_ms) * 1e6) : st
    return (
      <>
        {rs ? <i className="ph-retry" style={{ width: `${segw(span.start_ns, rs)}%` }} /> : null}
        <i className="ph-ttft" style={{ width: `${segw(st, tt)}%` }} />
        <i className="ph-solid" style={{ flex: 1 }} />
      </>
    )
  }
  if (k === "tool" || k === "agent") {
    const w = waitChild(span)
    return (
      <>
        {w ? <i className="ph-wait" style={{ width: `${segw(span.start_ns, w.end_ns)}%` }} /> : null}
        <i className={k === "agent" ? "ph-agent" : barClass(span)} style={{ flex: 1 }} />
      </>
    )
  }
  if (k === "wait") return <i className="ph-wait" style={{ width: "100%" }} />
  if (k === "turn") return <i className="ph-turn" style={{ width: "100%" }} />
  if (k === "hook") return <i className="ph-hook" style={{ width: "100%" }} />
  return <i className={barClass(span)} style={{ width: "100%" }} />
}
