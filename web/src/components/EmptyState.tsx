import { TerminalWindow } from "@phosphor-icons/react"
import { Link } from "wouter"

export function EmptyState({
  line,
  action,
  href,
  onClick,
  icon,
}: {
  line: string
  action: string
  href?: string
  onClick?: () => void
  icon?: React.ReactNode
}) {
  return (
    <div className="empty">
      <div className="e-ic">{icon || <TerminalWindow size={32} weight="regular" />}</div>
      <div className="e-t">{line}</div>
      {href ? (
        <Link href={href} className="btn pri">
          {action}
        </Link>
      ) : (
        <button type="button" className="btn pri" onClick={onClick}>
          {action}
        </button>
      )}
    </div>
  )
}
