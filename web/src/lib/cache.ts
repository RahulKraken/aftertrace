/** Last-known snapshot so a refresh paints data instead of a blank Loading… */

export function previewSkeleton(): boolean {
  if (typeof window === "undefined") return false
  const hash = window.location.hash || ""
  const search = window.location.search || ""
  return search.includes("skeleton=1") || /[?&]skeleton=1/.test(hash)
}
