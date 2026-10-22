import { useEffect, useState } from "react"

// Wall-clock milliseconds, refreshed every `ms`. Lets "12s ago" and elapsed
// timers tick without calling Date.now() during render.
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(t)
  }, [ms])
  return now
}
