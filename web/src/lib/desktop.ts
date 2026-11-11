export type UpdateState = {
  status: string
  version: string | null
  current: string
  error: string | null
  checkedAt?: number | null
}

export type AftertraceDesktop = {
  platform: string
  windowKind?: "dashboard" | "settings"
  getUpdate: () => Promise<UpdateState>
  checkUpdates: () => Promise<UpdateState | boolean>
  restartToUpdate: () => Promise<boolean>
  onUpdate: (fn: (state: UpdateState) => void) => () => void
  getAccentColor?: () => Promise<string>
  onAccentColor?: (fn: (hex: string) => void) => () => void
  openSettings?: () => Promise<void> | void
  getOpenAtLogin?: () => Promise<boolean>
  setOpenAtLogin?: (enabled: boolean) => Promise<boolean>
  engineStatus?: () => Promise<{ state: string }>
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

export function windowKind(): "dashboard" | "settings" {
  return desktop()?.windowKind || "dashboard"
}

export function displayVersion(raw: string | null | undefined): string {
  const n = String(raw || "").trim().replace(/^v/i, "")
  return n ? `v${n}` : ""
}
