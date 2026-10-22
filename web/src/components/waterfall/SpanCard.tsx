import { motion } from "motion/react"
import { TriangleAlert, X } from "lucide-react"
import { useEffect, useRef } from "react"
import { dur, modelName, tok, usd } from "../../lib/format"
import { contentFor, snippet, type ContentIndex } from "../../lib/content"
import { costOf, kindLabel, labelOf, rollup, spanKind, usageOf, waitChild, type SpanNode } from "../../lib/span"
import { glyphClass, SpanIcon } from "../SpanIcon"
import { rowLabel } from "../../lib/labels"

// The card a click opens, anchored under the bar it describes: what the call
// was, how it went, and its input and output. The full inspector is one more click.
export function SpanCard({
  span,
  content,
  running,
  t0,
  top,
  left,
  onClose,
  onDetails,
}: {
  span: SpanNode
  content: ContentIndex
  running: boolean
  t0: number
  top: number
  left: number
  onClose: () => void
  onDetails: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      // Clicks on rows choose a new card themselves; anywhere else closes this one.
      if (ref.current?.contains(t) || t.closest(".row")) return
      onClose()
    }
    window.addEventListener("pointerdown", away)
    return () => window.removeEventListener("pointerdown", away)
  }, [onClose])

  const k = spanKind(span)
  const { name } = rowLabel(span, content)
  const io = contentFor(span, content)
  const u = usageOf(span)
  const wait = waitChild(span)
  const cost = costOf(span)
  const failed = span.is_error || span.kids.some((c) => spanKind(c) === "run" && c.is_error)
  const status = failed ? "Failed" : running ? "Running" : "Done"
  const what = [kindLabel(span), k === "model" ? modelName(u.model) : contextOf(span)].filter(Boolean).join(" · ")
  const error = failed ? errorText(span) : ""

  return (
    <motion.div
        ref={ref}
        className="span-card"
        role="dialog"
        aria-label={`${name} details`}
        // Grows from the bar it belongs to (top left), never from nowhere.
        initial={{ opacity: 0, transform: "translateY(-4px) scale(0.96)" }}
        animate={{ opacity: 1, transform: "translateY(0px) scale(1)", transition: { duration: 0.22, ease: [0.23, 1, 0.32, 1] } }}
        exit={{ opacity: 0, transform: "translateY(-2px) scale(0.98)", transition: { duration: 0.12, ease: [0.23, 1, 0.32, 1] } }}
        style={{ top, left }}
      >
        <div className="sc-head">
          <span className={`glyph sc-glyph ${glyphClass(span)}`}>
            <SpanIcon span={span} />
          </span>
          <div className="sc-title">
            <div className="sc-name">{name}</div>
            <div className="sc-what">{what}</div>
          </div>
          <span className={`sc-status ${failed ? "fail" : running ? "run" : "ok"}`}>{status}</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close card" title="Close (Esc)">
            <X size={14} />
          </button>
        </div>
        <div className="sc-stats">
          <div>
            <span className="k">Duration</span>
            <span className="v">{dur(span.duration_ms)}</span>
          </div>
          <div>
            <span className="k">Started</span>
            <span className="v">+{dur((span.start_ns - t0) / 1e6)}</span>
          </div>
          {cost ? (
            <div>
              <span className="k">Cost</span>
              <span className="v">{usd(cost)}</span>
            </div>
          ) : null}
          {k === "model" && u.input != null ? (
            <div>
              <span className="k">Tokens in</span>
              <span className="v">{tok((u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0))}</span>
            </div>
          ) : null}
          {k === "model" && u.output != null ? (
            <div>
              <span className="k">Tokens out</span>
              <span className="v">{tok(u.output)}</span>
            </div>
          ) : null}
          {wait && wait.duration_ms >= 1000 ? (
            <div>
              <span className="k">Waited for you</span>
              <span className="v sc-wait">{dur(wait.duration_ms)}</span>
            </div>
          ) : null}
          {span.kids.length && (k === "agent" || k === "turn" || k === "span") ? (
            <div>
              <span className="k">Spans</span>
              <span className="v">{rollup(span).n}</span>
            </div>
          ) : null}
        </div>
        {error ? (
          <div className="sc-error">
            <TriangleAlert size={14} />
            <span>{error}</span>
          </div>
        ) : null}
        {io.input ? (
          <div className="sc-io">
            <div className="k">{io.inputLabel}</div>
            <div className="sc-text">{snippet(io.input, 240)}</div>
          </div>
        ) : null}
        {io.output ? (
          <div className="sc-io">
            <div className="k">{io.outputLabel}</div>
            <div className="sc-text">{snippet(io.output, 240)}</div>
          </div>
        ) : null}
        <button type="button" className="sc-more" onClick={onDetails}>
          All details
        </button>
      </motion.div>
  )
}

function contextOf(span: SpanNode): string {
  const a = span.attrs
  const t = String(a.tool_name || "")
  if (t.startsWith("mcp__")) return String(a["anthropic.mcp.server.name"] || t.split("__")[1] || "").replace(/_/g, " ")
  return t || labelOf(span).target
}

function errorText(span: SpanNode): string {
  const run = span.kids.find((c) => spanKind(c) === "run" && c.is_error)
  const s = run || span
  return String(s.status_message || s.attrs.error || s.attrs.error_class || s.attrs["error.type"] || "This call failed.")
}
