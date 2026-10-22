import type { Finding } from "./types"

const KEY = "aftertrace-resolved"
// Nothing is resolved until the user resolves it. The e2e suite seeds its own state.
const SEED: string[] = []

// A finding's id is only its place in this response, so a mark is kept by
// what the finding is about: its rule and its headline with the numbers out.
// "6 permission prompts for Bash(npm test:*)" stays done at 9 prompts.
export function findingKey(f: Pick<Finding, "rule_id" | "headline">): string {
  return `${f.rule_id}:${f.headline.replace(/\d+(?:[.,:]\d+)*/g, "#")}`
}

function read(): string[] {
  if (typeof window === "undefined") return SEED
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) {
      window.localStorage.setItem(KEY, JSON.stringify(SEED))
      return SEED.slice()
    }
    const parsed = JSON.parse(raw) as unknown
    // Marks saved by position (numbers) can't be matched to a finding any more.
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : SEED.slice()
  } catch {
    return SEED.slice()
  }
}

export function resolvedKeys(): Set<string> {
  return new Set(read())
}

export function resolveFinding(f: Pick<Finding, "rule_id" | "headline">) {
  const next = [...new Set([...read(), findingKey(f)])]
  window.localStorage.setItem(KEY, JSON.stringify(next))
  window.dispatchEvent(new Event("aftertrace-wins"))
}

export function onWins(cb: () => void): () => void {
  const handler = () => cb()
  window.addEventListener("aftertrace-wins", handler)
  window.addEventListener("storage", handler)
  return () => {
    window.removeEventListener("aftertrace-wins", handler)
    window.removeEventListener("storage", handler)
  }
}
