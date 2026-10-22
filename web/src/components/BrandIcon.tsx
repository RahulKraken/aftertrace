import type { SimpleIcon } from "simple-icons"

// An official brand mark from Simple Icons (CC0). Marks that are black or
// near-black by brand (GitHub, Notion, Vercel) follow the text colour so they
// stay visible in dark mode; the rest keep their brand colour.
export function BrandIcon({ icon, size = 14, mono = false }: { icon: SimpleIcon; size?: number; mono?: boolean }) {
  const fill = mono || isDark(icon.hex) ? "currentColor" : `#${icon.hex}`
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-label={icon.title} className="brand-icon">
      <path d={icon.path} fill={fill} />
    </svg>
  )
}

function isDark(hex: string): boolean {
  const n = parseInt(hex, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 60
}
