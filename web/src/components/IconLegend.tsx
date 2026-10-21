import {
  Bot,
  FilePenLine,
  FileText,
  Globe,
  MessageSquare,
  Pause,
  Play,
  Plug,
  Search,
  Sparkles,
  SquareTerminal,
  WandSparkles,
  Workflow,
} from "lucide-react"

const ITEMS = [
  { Icon: MessageSquare, label: "turn" },
  { Icon: Sparkles, label: "model" },
  { Icon: SquareTerminal, label: "Bash" },
  { Icon: FileText, label: "read" },
  { Icon: FilePenLine, label: "edit" },
  { Icon: Search, label: "search" },
  { Icon: Globe, label: "web" },
  { Icon: WandSparkles, label: "skill" },
  { Icon: Plug, label: "MCP" },
  { Icon: Bot, label: "subagent" },
  { Icon: Pause, label: "waiting on you" },
  { Icon: Play, label: "run" },
  { Icon: Workflow, label: "hook" },
]

export function IconLegend() {
  return (
    <div className="icon-legend">
      span
      <div className="icon-legend-pop">
        {ITEMS.map(({ Icon, label }) => (
          <div key={label}>
            <Icon size={12} strokeWidth={1.75} />
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}
