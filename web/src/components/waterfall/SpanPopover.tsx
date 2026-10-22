import { AnimatePresence, motion } from "motion/react"
import { dur, usd, wallClock } from "../../lib/format"
import { contentFor, snippet, type ContentIndex } from "../../lib/content"
import { costOf, kindLabel, labelOf, type SpanNode } from "../../lib/span"

export function SpanPopover({
  span,
  top,
  left,
  running,
  content,
}: {
  span: SpanNode | null
  top: number
  left: number
  running?: boolean
  content: ContentIndex
}) {
  return (
    <AnimatePresence>
      {span ? (
        <motion.div
          className={`span-pop${span.is_error ? " err" : ""}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          style={{ top, left }}
          role="tooltip"
        >
          <PopBody span={span} running={running} content={content} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function PopBody({ span, running, content }: { span: SpanNode; running?: boolean; content: ContentIndex }) {
  const { name, target } = labelOf(span)
  const io = contentFor(span, content)
  const status = span.is_error ? "Failed" : running ? "Running" : "Done"
  return (
    <>
      <div className="pop-hd">
        <div className="pop-name">{name}</div>
        <span className={`pop-st ${span.is_error ? "fail" : running ? "run" : "ok"}`}>{status}</span>
      </div>
      <div className="pop-sub">
        {kindLabel(span)}
        {target ? ` · ${target}` : ""}
      </div>
      <div className="pop-stats">
        <div>
          <div className="k">Duration</div>
          <div className="v">{dur(span.duration_ms)}</div>
        </div>
        <div>
          <div className="k">Started</div>
          <div className="v">{wallClock(span.start_ns)}</div>
        </div>
        <div>
          <div className="k">Cost</div>
          <div className="v">{usd(costOf(span) || null)}</div>
        </div>
      </div>
      {span.is_error ? (
        <div className="pop-err">{span.status_message || String(span.attrs.error_class || "span failed")}</div>
      ) : (
        <>
          {io.input && (
            <div className="pop-io">
              <div className="k">{io.inputLabel}</div>
              <div className="pop-text">{snippet(io.input, 180)}</div>
            </div>
          )}
          {io.output && (
            <div className="pop-io">
              <div className="k">{io.outputLabel}</div>
              <div className="pop-text">{snippet(io.output, 180)}</div>
            </div>
          )}
        </>
      )}
    </>
  )
}
