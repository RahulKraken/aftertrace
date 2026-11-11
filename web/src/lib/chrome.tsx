import { MagnifyingGlass } from "@phosphor-icons/react"
import type { ReactNode } from "react"
import { Link } from "wouter"
import { searchShortcut } from "./desktop"

export function SearchField({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="search" onClick={onClick} aria-label="Search">
      <MagnifyingGlass size={14} weight="regular" />
      Search
      <kbd>{searchShortcut()}</kbd>
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
  ariaLabel: string
}) {
  return (
    <div className="seg" role="tablist" aria-label={ariaLabel}>
      {options.map((o) => (
        <button type="button" key={o.id} className={value === o.id ? "on" : ""} role="tab" aria-selected={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toolbar({
  title,
  sub,
  children,
}: {
  title?: ReactNode
  sub?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="tb">
      {title ? <h1>{title}</h1> : null}
      {sub ? <span className="sub">{sub}</span> : null}
      <span className="sp" />
      {children}
    </div>
  )
}

export function Crumb({ href, children }: { href?: string; children: ReactNode }) {
  if (href) return <Link href={href}>{children}</Link>
  return <span>{children}</span>
}
