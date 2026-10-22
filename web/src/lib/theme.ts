const KEY = "aftertrace-theme"

export type Theme = "light" | "dark"

export function readTheme(): Theme {
  if (typeof window === "undefined") return "light"
  const saved = window.localStorage.getItem(KEY)
  if (saved === "dark" || saved === "light") return saved
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  window.localStorage.setItem(KEY, theme)
}

// Light and dark cross-fade instead of every colour snapping at once. The
// View Transitions API snapshots the page, so the swap is one smooth fade;
// browsers without it (or with reduced motion) switch straight away.
export function switchTheme(next: Theme, set: (t: Theme) => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  if (!doc.startViewTransition || reduce) {
    set(next)
    return
  }
  doc.startViewTransition(() => {
    applyTheme(next)
    set(next)
  })
}
