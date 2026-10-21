import { animate, motion, useReducedMotion } from "motion/react"
import { useEffect, useRef } from "react"
import type { Win } from "../lib/fixes"
import { WIN_MS } from "../lib/fixes"

function SettlingNumber({ value }: { value: number }) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (reduce) {
      el.textContent = String(value)
      return
    }
    const ctrl = animate(0, value, {
      type: "spring",
      bounce: 0.12,
      visualDuration: 0.55,
      onUpdate: (v) => {
        el.textContent = String(Math.round(v))
      },
    })
    return () => ctrl.stop()
  }, [value, reduce])

  return <span ref={ref}>{reduce ? value : 0}</span>
}

export function WinStage({ win, onDone }: { win: Win; onDone: () => void }) {
  const reduce = useReducedMotion()

  useEffect(() => {
    const t = window.setTimeout(onDone, WIN_MS)
    return () => window.clearTimeout(t)
  }, [onDone])

  return (
    <motion.div
      className="win-stage"
      role="status"
      aria-live="assertive"
      onClick={onDone}
      initial={reduce ? false : { opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", bounce: 0.16, visualDuration: 0.42 }}
    >
      <div className="win-face">
        <div className="win-figure">
          <SettlingNumber value={win.figure} />
        </div>
        <div className="win-label">{win.label}</div>
        {win.saved ? <div className="win-aside">{win.saved} saved</div> : null}
      </div>
    </motion.div>
  )
}
