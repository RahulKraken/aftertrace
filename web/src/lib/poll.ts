export const RETRY_EVENT = "aftertrace-retry"

/** Single-flight poll. Never overlaps. Backs off while a request is in flight
 *  and uses a slower cadence when the document is hidden. Failed fetches
 *  retry with exponential backoff up to 15s. */
export function startPoll(
  fn: () => Promise<void>,
  opts: { visibleMs: number; hiddenMs: number },
): () => void {
  let inflight = false
  let timer = 0
  let stopped = false
  let backoff = 0
  const tick = async () => {
    if (stopped || inflight) return
    inflight = true
    let failed = false
    try {
      await fn()
      backoff = 0
    } catch {
      failed = true
      backoff = backoff === 0 ? 800 : Math.min(backoff * 2, 15_000)
    } finally {
      inflight = false
      if (!stopped) {
        const hidden = typeof document !== "undefined" && document.hidden
        const wait = hidden ? opts.hiddenMs : failed ? backoff : opts.visibleMs
        timer = window.setTimeout(tick, wait)
      }
    }
  }
  tick()
  const onVis = () => {
    if (stopped || document.hidden || inflight) return
    window.clearTimeout(timer)
    tick()
  }
  const onRetry = () => {
    if (stopped || inflight) return
    window.clearTimeout(timer)
    tick()
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVis)
  }
  if (typeof window !== "undefined") {
    window.addEventListener(RETRY_EVENT, onRetry)
  }
  return () => {
    stopped = true
    window.clearTimeout(timer)
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVis)
    }
    if (typeof window !== "undefined") {
      window.removeEventListener(RETRY_EVENT, onRetry)
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
