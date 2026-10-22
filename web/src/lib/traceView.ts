export type TraceView = "story" | "timeline"

const KEY = "aftertrace-trace-view"

export function savedView(): TraceView {
  try {
    return window.localStorage.getItem(KEY) === "timeline" ? "timeline" : "story"
  } catch {
    return "story"
  }
}

export function saveView(v: TraceView) {
  try {
    window.localStorage.setItem(KEY, v)
  } catch {
    // Storage can be blocked; the choice just won't stick.
  }
}
