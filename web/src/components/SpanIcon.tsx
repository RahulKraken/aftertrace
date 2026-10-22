import type { LucideIcon } from "lucide-react"
import {
  Asterisk,
  Bot,
  Bug,
  Calendar,
  CreditCard,
  Database,
  GitBranch,
  Kanban,
  Mail,
  Notebook,
  PenTool,
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

// Connector servers get an icon for what they are, so a Linear call looks
// different from a database query at a glance. Unknown servers keep the plug.
const SERVERS: [RegExp, LucideIcon][] = [
  [/linear|jira|asana|trello/i, Kanban],
  [/github|gitlab|git\b/i, GitBranch],
  [/notion|confluence|docs/i, Notebook],
  [/sentry|bugsnag/i, Bug],
  [/stripe|billing|pay/i, CreditCard],
  [/postgres|mysql|sqlite|supabase|database|db\b|bigquery|snowflake/i, Database],
  [/browser|playwright|puppeteer|chrome/i, Globe],
  [/figma|design/i, PenTool],
  [/gmail|mail/i, Mail],
  [/calendar/i, Calendar],
  [/slack|discord|teams/i, MessageSquare],
]

function serverOf(span: Span): string {
  const a = span.attrs
  const t = String(a.tool_name || "")
  return String(a["anthropic.mcp.server.name"] || span.joined?.["mcp_server.name"] || (t.startsWith("mcp__") ? t.split("__")[1] : "") || "")
}

export function SpanIcon({ span }: { span: Span }) {
  const key = String(familyOf(span))
  let Icon = ICONS[key] || Wrench
  if (key === "mcp") {
    const server = serverOf(span)
    Icon = SERVERS.find(([re]) => re.test(server))?.[1] || Plug
  }
  // Claude's mark for Claude model calls, as the model's own sign.
  if (key === "model" && /claude|opus|sonnet|haiku|fable/i.test(String(span.attrs.model || span.attrs["gen_ai.request.model"] || span.joined?.model || ""))) Icon = Asterisk
  return <Icon strokeWidth={1.75} aria-hidden />
}
