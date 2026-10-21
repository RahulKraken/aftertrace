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
