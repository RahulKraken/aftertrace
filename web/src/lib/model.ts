export type ModelFamily = "opus" | "sonnet" | "haiku" | "other"

export function modelFamily(id: string | null | undefined): ModelFamily {
  const s = (id || "").toLowerCase()
  if (s.includes("opus")) return "opus"
  if (s.includes("sonnet")) return "sonnet"
  if (s.includes("haiku")) return "haiku"
  return "other"
}

export function modelSlug(id: string | null | undefined): string {
  const f = modelFamily(id)
  if (f !== "other") return f
  const s = (id || "").replace(/^(anthropic|openai|google)[/.]/, "").replace(/^claude-/, "")
  const rest = s.split("-")[0]
  return rest || "model"
}

export function primaryModel(models: string[] | null | undefined): string {
  if (!models?.length) return ""
  const order: ModelFamily[] = ["opus", "sonnet", "haiku"]
  for (const f of order) {
    const hit = models.find((m) => modelFamily(m) === f)
    if (hit) return hit
  }
  return models[0]
}

const FIVE_H = 5 * 3600e9

export type UsageWindow = {
  start_ns: number
  end_ns: number
  elapsed_ns: number
  left_ns: number
}

// Claude Code 5h window: first activity after a 5h gap, only if we can see it.
export function usageWindow(
  now_ns: number,
  starts: number[],
): UsageWindow | null {
  const recent = starts.filter((t) => t > 0 && t <= now_ns && now_ns - t < FIVE_H)
  if (!recent.length) return null
  const start = Math.min(...recent)
  const end = start + FIVE_H
  const left = end - now_ns
  if (left <= 0) return null
  return { start_ns: start, end_ns: end, elapsed_ns: now_ns - start, left_ns: left }
}
