const KEY = "aftertrace-theme"

export type Theme = "light" | "dark"

export function readTheme(): Theme {
  if (typeof window === "undefined") return "light"
  const saved = window.localStorage.getItem(KEY)
  if (saved === "dark" || saved === "light") return saved
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function hasStoredTheme(): boolean {
  if (typeof window === "undefined") return false
  const saved = window.localStorage.getItem(KEY)
  return saved === "dark" || saved === "light"
}

export function applyTheme(theme: Theme, persist = false) {
  document.documentElement.dataset.theme = theme
  if (persist) window.localStorage.setItem(KEY, theme)
}

export function switchTheme(next: Theme, set: (t: Theme) => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  if (!doc.startViewTransition || reduce) {
    applyTheme(next, true)
    set(next)
    return
  }
  doc.startViewTransition(() => {
    applyTheme(next, true)
    set(next)
  })
}
