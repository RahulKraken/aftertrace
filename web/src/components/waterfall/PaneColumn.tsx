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
    <div className="pane-col" style={{ width: w }} ref={ref}>
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
    </div>
  )
}
