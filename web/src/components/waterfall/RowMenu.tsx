import { motion } from "motion/react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

export type MenuItem =
  | { label: string; hint?: string; disabled?: boolean; onSelect: () => void | "keep" }
  | { sep: true }

// A small menu for one waterfall row, opened from its ⋯ button or a right
// click. It grows from where it was opened, closes on Escape or a click away,
// and the arrow keys walk its items.
export function RowMenu({
  at,
  items,
  onClose,
}: {
  at: { x: number; y: number; from: "button" | "pointer" }
  items: MenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null)

  // Keep the menu on screen; it opens left of a ⋯ button and right of a pointer.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    let left = at.from === "button" ? at.x - w : at.x
    let top = at.y + 4
    let ox = at.from === "button" ? "right" : "left"
    let oy = "top"
    if (left + w > innerWidth - 8) {
      left = at.x - w
      ox = "right"
    }
    if (left < 8) left = 8
    if (top + h > innerHeight - 8) {
      top = at.y - h - 4
      oy = "bottom"
    }
    setPos({ left, top, origin: `${ox} ${oy}` })
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true })
  }, [at])

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const scroll = () => onClose()
    addEventListener("pointerdown", away, true)
    addEventListener("resize", scroll)
    return () => {
      removeEventListener("pointerdown", away, true)
      removeEventListener("resize", scroll)
    }
  }, [onClose])

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || [])]
    const i = btns.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === "Escape") onClose()
    else if (e.key === "ArrowDown" || e.key === "j") btns[(i + 1) % btns.length]?.focus()
    else if (e.key === "ArrowUp" || e.key === "k") btns[(i - 1 + btns.length) % btns.length]?.focus()
    else if (e.key === "Tab") onClose()
    else return
    e.preventDefault()
  }

  return createPortal(
    <motion.div
      ref={ref}
      className="row-menu"
      role="menu"
      onKeyDown={onKey}
      onContextMenu={(e) => e.preventDefault()}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={pos ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
      style={{ left: pos?.left ?? at.x, top: pos?.top ?? at.y, transformOrigin: pos?.origin }}
    >
      {items.map((it, i) =>
        "sep" in it ? (
          <i key={i} className="row-menu-sep" role="separator" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              if (it.onSelect() !== "keep") onClose()
            }}
          >
            <span>{it.label}</span>
            {it.hint ? <kbd>{it.hint}</kbd> : null}
          </button>
        ),
      )}
    </motion.div>,
    document.body,
  )
}
