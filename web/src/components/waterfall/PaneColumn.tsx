import { motion } from "motion/react"
import { useRef, useState, type ReactNode } from "react"
import { readPx, startDrag, writePx } from "../../lib/drag"

const PANE_KEY = "aftertrace-pane-w"
const PANE_MIN = 320
// The main view keeps at least this much room when the pane grows.
const MAIN_MIN = 420

// The inspector column: resizable from its left edge, width remembered.
export function PaneColumn({ children }: { children: ReactNode }) {
  const [w, setW] = useState(() => readPx(PANE_KEY, 520) as number)
  const ref = useRef<HTMLDivElement>(null)
  return (
    // Slides in from the edge it lives on; leaves faster than it came.
    <motion.div
      className="pane-col"
      style={{ width: w }}
      ref={ref}
      initial={{ opacity: 0, transform: "translateX(16px)" }}
      animate={{ opacity: 1, transform: "translateX(0px)", transition: { duration: 0.32, ease: [0.32, 0.72, 0, 1] } }}
      exit={{ opacity: 0, transform: "translateX(12px)", transition: { duration: 0.16, ease: [0.23, 1, 0.32, 1] } }}
    >
      <div
        className="pane-resizer"
        title="Drag to resize. Double-click to reset."
        onDoubleClick={() => {
          setW(520)
          writePx(PANE_KEY, null)
        }}
        onPointerDown={(e) => {
          const total = ref.current?.parentElement?.getBoundingClientRect().width || window.innerWidth
          const w0 = w
          let last = w0
          startDrag(
            e,
            (dx) => {
              last = Math.max(PANE_MIN, Math.min(total - MAIN_MIN, w0 - dx))
              setW(last)
            },
            () => writePx(PANE_KEY, last),
          )
        }}
      />
      {children}
    </motion.div>
  )
}
