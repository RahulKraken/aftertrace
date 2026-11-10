export type UpdateState = {
  status: string
  version: string | null
  current: string
  error: string | null
  checkedAt?: number | null
}

export type AftertraceDesktop = {
  platform: string
  getUpdate: () => Promise<UpdateState>
  checkUpdates: () => Promise<UpdateState | boolean>
  restartToUpdate: () => Promise<boolean>
  onUpdate: (fn: (state: UpdateState) => void) => () => void
}

declare global {
  interface Window {
    aftertraceDesktop?: AftertraceDesktop
  }
}

export function desktop(): AftertraceDesktop | null {
  if (typeof window === "undefined") return null
  return window.aftertraceDesktop || null
}

export function displayVersion(raw: string | null | undefined): string {
  const n = String(raw || "").trim().replace(/^v/i, "")
  return n ? `v${n}` : ""
}
