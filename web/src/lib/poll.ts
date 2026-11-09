/** Single-flight poll. Never overlaps. Backs off while a request is in flight
 *  and uses a slower cadence when the document is hidden. */
export function startPoll(
  fn: () => Promise<void>,
  opts: { visibleMs: number; hiddenMs: number },
): () => void {
  let inflight = false
  let timer = 0
  let stopped = false
  const delay = () =>
    typeof document !== "undefined" && document.hidden ? opts.hiddenMs : opts.visibleMs
  const tick = async () => {
    if (stopped || inflight) return
    inflight = true
    try {
      await fn()
    } finally {
      inflight = false
      if (!stopped) timer = window.setTimeout(tick, delay())
    }
  }
  tick()
  const onVis = () => {
    if (stopped || document.hidden || inflight) return
    window.clearTimeout(timer)
    tick()
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVis)
  }
  return () => {
    stopped = true
    window.clearTimeout(timer)
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVis)
    }
  }
}

export function readCached<T>(key: string): T | null {
  if (typeof sessionStorage === "undefined") return null
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function writeCached(key: string, value: unknown): void {
  if (typeof sessionStorage === "undefined") return
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota */
  }
}
