import { animate, useReducedMotion } from "motion/react"
import { useEffect, useRef, useState } from "react"

// A number that counts to its value when it first appears and glides to each
// new value after that, so a live total visibly moves instead of jumping.
// Feedback (Norman): you can see that something changed, and by how much.
export function Num({ value, format, duration = 0.9 }: { value: number; format: (n: number) => string; duration?: number }) {
  const reduce = useReducedMotion()
  const from = useRef(0)
  const [shown, setShown] = useState(() => (reduce ? value : 0))
  useEffect(() => {
    if (reduce || !Number.isFinite(value)) {
      from.current = value
      setShown(value)
      return
    }
    const c = animate(from.current, value, {
      duration: from.current === 0 ? duration : 0.5,
      ease: [0.23, 1, 0.32, 1],
      onUpdate: (v) => setShown(v),
    })
    from.current = value
    return () => c.stop()
  }, [value, duration, reduce])
  return <span className="count">{format(shown)}</span>
}
