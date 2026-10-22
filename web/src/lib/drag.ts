export function readPx(key: string, fallback: number | null): number | null {
  try {
    const v = Number(window.localStorage.getItem(key))
    return Number.isFinite(v) && v > 0 ? v : fallback
  } catch {
    return fallback
  }
}

export function writePx(key: string, v: number | null) {
  try {
    if (v == null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, String(Math.round(v)))
  } catch {
    // Storage can be blocked. Width just resets next time.
  }
}

// Pointer drag with body-level cursor and no text selection while it runs.
export function startDrag(e: React.PointerEvent, onMove: (dx: number) => void, onEnd: () => void) {
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
