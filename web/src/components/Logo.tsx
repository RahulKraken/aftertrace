// The mark: three waterfall bars on a shared time axis, the last one amber
// (waiting on you). Drawn in currentColor so it follows the theme.
export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="4" width="13" height="4" rx="2" fill="currentColor" />
      <rect x="7" y="10" width="15" height="4" rx="2" fill="currentColor" opacity="0.55" />
      <rect x="12" y="16" width="8" height="4" rx="2" fill="var(--hue-wait)" />
    </svg>
  )
}
