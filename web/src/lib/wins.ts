import type { Finding } from "./types"

const KEY = "aftertrace-resolved"
// Nothing is resolved until the user resolves it. The e2e suite seeds its own state.
const SEED: Mark[] = []

type Mark = { key: string; at: number }

// A finding's id is only its place in this response, so a mark is kept by
// what the finding is about: its rule and its headline with the numbers out.
// "6 permission prompts for Bash(npm test:*)" stays done at 9 prompts.
export function findingKey(f: Pick<Finding, "rule_id" | "headline">): string {
  return `${f.rule_id}:${f.headline.replace(/\d+(?:[.,:]\d+)*/g, "#")}`
}

function asMark(x: unknown): Mark | null {
  if (typeof x === "string") return { key: x, at: Date.now() }
  if (x && typeof x === "object" && typeof (x as Mark).key === "string") {
    const at = Number((x as Mark).at)
    return { key: (x as Mark).key, at: Number.isFinite(at) && at > 0 ? at : Date.now() }
  }
  return null
}

function read(): Mark[] {
  if (typeof window === "undefined") return SEED.slice()
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) {
      window.localStorage.setItem(KEY, JSON.stringify(SEED))
      return SEED.slice()
    }
    const parsed = JSON.parse(raw) as unknown
    // Marks saved by position (numbers) can't be matched to a finding any more.
    if (!Array.isArray(parsed)) return SEED.slice()
    return parsed.map(asMark).filter((m): m is Mark => Boolean(m))
  } catch {
    return SEED.slice()
  }
}

function write(next: Mark[]) {
  window.localStorage.setItem(KEY, JSON.stringify(next))
  window.dispatchEvent(new Event("aftertrace-wins"))
}

export function resolvedKeys(): Set<string> {
  return new Set(read().map((m) => m.key))
}

export function resolvedAt(key: string): number | null {
  return read().find((m) => m.key === key)?.at ?? null
}

export function openFindings<T extends Pick<Finding, "rule_id" | "headline">>(fs: T[], keys = resolvedKeys()): T[] {
  return fs.filter((f) => !keys.has(findingKey(f)))
}

export function resolveFinding(f: Pick<Finding, "rule_id" | "headline">) {
  const key = findingKey(f)
  const prev = read().filter((m) => m.key !== key)
  write([...prev, { key, at: Date.now() }])
}

export function reopenFinding(f: Pick<Finding, "rule_id" | "headline">) {
  write(read().filter((m) => m.key !== findingKey(f)))
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
