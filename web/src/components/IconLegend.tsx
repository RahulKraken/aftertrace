import type { ReactNode } from "react"
import { Bot, FilePenLine, FileText, Globe, Hourglass, MessageSquare, Play, Plug, SquareTerminal, TextSearch, WandSparkles, Webhook } from "lucide-react"
import { siClaude } from "simple-icons"
import { BrandIcon } from "./BrandIcon"

const ITEMS: { icon: ReactNode; label: string }[] = [
  { icon: <MessageSquare size={12} strokeWidth={1.75} />, label: "your prompt" },
  { icon: <BrandIcon icon={siClaude} size={12} />, label: "model call" },
  { icon: <SquareTerminal size={12} strokeWidth={1.75} />, label: "shell command (or the program's own mark)" },
  { icon: <FileText size={12} strokeWidth={1.75} />, label: "read a file" },
  { icon: <FilePenLine size={12} strokeWidth={1.75} />, label: "edit a file" },
  { icon: <TextSearch size={12} strokeWidth={1.75} />, label: "search" },
  { icon: <Globe size={12} strokeWidth={1.75} />, label: "web" },
  { icon: <WandSparkles size={12} strokeWidth={1.75} />, label: "skill" },
  { icon: <Plug size={12} strokeWidth={1.75} />, label: "connector (the service's mark when known)" },
  { icon: <Bot size={12} strokeWidth={1.75} />, label: "subagent" },
  { icon: <Hourglass size={12} strokeWidth={1.75} />, label: "waiting on you" },
  { icon: <Play size={12} strokeWidth={1.75} />, label: "running" },
  { icon: <Webhook size={12} strokeWidth={1.75} />, label: "hook" },
]

export function IconLegend() {
  return (
    <div className="icon-legend">
      span
      <div className="icon-legend-pop">
        {ITEMS.map(({ icon, label }) => (
          <div key={label}>
            {icon}
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}
