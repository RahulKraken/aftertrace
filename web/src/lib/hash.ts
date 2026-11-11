export function hashQuery(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams()
  const h = window.location.hash || ""
  const q = h.includes("?") ? h.slice(h.indexOf("?") + 1) : ""
  return new URLSearchParams(q || window.location.search.replace(/^\?/, ""))
}

export function hashParam(name: string): string | null {
  return hashQuery().get(name)
}
