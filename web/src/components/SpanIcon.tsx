import type { LucideIcon } from "lucide-react"
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
  Wrench,
} from "lucide-react"
import { familyOf, spanKind, toolFamily } from "../lib/span"
import type { Span } from "../lib/types"

const ICONS: Record<string, LucideIcon> = {
  turn: MessageSquare,
  model: Sparkles,
  wait: Pause,
  run: Play,
  hook: Workflow,
  bash: SquareTerminal,
  read: FileText,
  edit: FilePenLine,
  search: Search,
  web: Globe,
  skill: WandSparkles,
  mcp: Plug,
  agent: Bot,
  other: Wrench,
  tool: Wrench,
  span: Wrench,
}

export function glyphClass(s: Span): string {
  const k = spanKind(s)
  if (k === "turn") return "g-turn"
  if (k === "wait") return "g-wait"
  if (k === "model") return "g-model"
  if (k === "hook") return "g-hook"
  if (k === "agent") return "g-agent"
  if (k === "tool" || k === "run") {
    const f = toolFamily(String(s.attrs.tool_name || ""))
    if (f === "bash") return "g-bash"
    if (f === "read" || f === "edit" || f === "search") return "g-file"
    if (f === "mcp") return "g-mcp"
    if (f === "skill") return "g-skill"
    if (f === "web") return "g-web"
    if (f === "agent") return "g-agent"
    return "g-tool"
  }
  return ""
}

export function barClass(s: Span): string {
  const k = spanKind(s)
  if (k === "model") return "ph-solid"
  if (k === "wait") return "ph-wait"
  if (k === "hook") return "ph-hook"
  if (k === "turn") return "ph-turn"
  if (k === "agent") return "ph-agent"
  if (k === "run" || k === "tool") {
    const f = toolFamily(String(s.attrs.tool_name || ""))
    if (f === "bash") return "ph-bash"
    if (f === "mcp") return "ph-mcp"
    if (f === "skill") return "ph-skill"
    if (f === "agent") return "ph-agent"
    if (f === "read" || f === "edit" || f === "search") return "ph-file"
    return "ph-tool"
  }
  // Generic spans (an HTTP handler, a job) are structure, not work: neutral.
  return "ph-turn"
}

export function SpanIcon({ span }: { span: Span }) {
  const key = String(familyOf(span))
  const Icon = ICONS[key] || Wrench
  return <Icon strokeWidth={1.75} aria-hidden />
}
