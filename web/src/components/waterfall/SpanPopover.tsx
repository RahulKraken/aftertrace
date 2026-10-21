import { AnimatePresence, motion } from "motion/react"
import { dur, usd, wallClock } from "../../lib/format"
import { costOf, kindLabel, labelOf, type SpanNode } from "../../lib/span"

export function SpanPopover({
  span,
  top,
  left,
  running,
}: {
  span: SpanNode | null
  top: number
  left: number
  running?: boolean
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
          <PopBody span={span} running={running} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function PopBody({ span, running }: { span: SpanNode; running?: boolean }) {
  const { name, target } = labelOf(span)
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
          <div className="pop-io">
            <div className="k">Input</div>
            <div className="content-hidden">content hidden</div>
          </div>
          <div className="pop-io">
            <div className="k">Output</div>
            <div className="content-hidden">content hidden</div>
          </div>
        </>
      )}
    </>
  )
}
