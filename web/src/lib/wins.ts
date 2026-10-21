const KEY = "aftertrace-resolved"
const SEED = [4]

function read(): number[] {
  if (typeof window === "undefined") return SEED
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) {
      window.localStorage.setItem(KEY, JSON.stringify(SEED))
      return SEED.slice()
    }
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.map(Number) : SEED.slice()
  } catch {
    return SEED.slice()
  }
}

export function resolvedIds(): Set<number> {
  return new Set(read())
}

export function isResolved(id: number): boolean {
  return resolvedIds().has(id)
}

export function resolveFinding(id: number) {
  const next = [...new Set([...read(), id])]
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
