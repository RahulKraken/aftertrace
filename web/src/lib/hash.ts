import { useEffect, useMemo } from "react"
import { useHashLocation } from "wouter/use-hash-location"

/** Query string from a hash route (`#/sessions?src=apps`). */
export function hashQuery(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams()
  const h = window.location.hash || ""
  const i = h.indexOf("?")
  if (i >= 0) return new URLSearchParams(h.slice(i + 1))
  // Wouter's stock hash navigate puts `?` on location.search; read that too.
  return new URLSearchParams((window.location.search || "").replace(/^\?/, ""))
}

/**
 * Keep `?query` in the hash (`#/settings?tab=query`).
 * Wouter's built-in hash `navigate` splits on `?` and writes the query to
 * `location.search`, which drops it from hash routes.
 */
export function hashGo(to: string, opts?: { replace?: boolean }) {
  if (typeof window === "undefined") return
  const path = to.replace(/^#/, "")
  const hash = path.startsWith("/") ? path : `/${path}`
  const oldURL = window.location.href
  const next = `${window.location.pathname}#${hash}`
  if (window.location.pathname + window.location.hash === next && !window.location.search) return
  history[opts?.replace ? "replaceState" : "pushState"](history.state, "", next)
  const newURL = window.location.href
  dispatchEvent(
    typeof HashChangeEvent !== "undefined"
      ? new HashChangeEvent("hashchange", { oldURL, newURL })
      : new Event("hashchange"),
  )
}

export function hashHrefs(href: string): string {
  return href.startsWith("#") ? href : `#${href}`
}

/** Path without query, navigate that keeps query in the hash. */
export function useHashPath(): [string, (to: string, opts?: { replace?: boolean }) => void] {
  const [loc] = useHashLocation()
  return [loc.split("?")[0], hashGo]
}
useHashPath.hrefs = hashHrefs

export function useHashQuery(): URLSearchParams {
  const [loc] = useHashLocation()
  return useMemo(() => {
    const i = loc.indexOf("?")
    if (i >= 0) return new URLSearchParams(loc.slice(i + 1))
    return hashQuery()
  }, [loc])
}

/** Replace the current hash route, keeping extra query params. */
export function HashRedirect({ to, set, remap }: { to: string; set?: Record<string, string>; remap?: Record<string, string> }) {
  useEffect(() => {
    const q = hashQuery()
    if (remap) {
      for (const [from, toKey] of Object.entries(remap)) {
        const v = q.get(from)
        if (v && !q.get(toKey)) q.set(toKey, v)
      }
    }
    if (set) for (const [k, v] of Object.entries(set)) q.set(k, v)
    const s = q.toString()
    hashGo(s ? `${to}?${s}` : to, { replace: true })
    // set/remap are call-site constants; do not re-run on new object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to])
  return null
}
