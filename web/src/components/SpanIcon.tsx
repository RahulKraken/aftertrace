import type { LucideIcon } from "lucide-react"
import {
  Bot,
  FilePenLine,
  FilePlus2,
  FileText,
  FolderSearch,
  Globe,
  Hash,
  Hourglass,
  ListTodo,
  MessageCircleQuestion,
  MessageSquare,
  NotebookPen,
  Play,
  Plug,
  Route,
  Sparkles,
  SquareTerminal,
  TextSearch,
  WandSparkles,
  Webhook,
  Wrench,
} from "lucide-react"
import type { SimpleIcon } from "simple-icons"
import {
  siAirtable,
  siAsana,
  siClaude,
  siCloudflare,
  siConfluence,
  siDiscord,
  siDocker,
  siDuckdb,
  siFigma,
  siGit,
  siGithub,
  siGitlab,
  siGmail,
  siGo,
  siGooglecalendar,
  siGooglechrome,
  siGooglegemini,
  siHomebrew,
  siHubspot,
  siHuggingface,
  siJira,
  siKubernetes,
  siLinear,
  siMeta,
  siMistralai,
  siMongodb,
  siMysql,
  siNodedotjs,
  siNotion,
  siNpm,
  siObsidian,
  siOllama,
  siPerplexity,
  siPnpm,
  siPostgresql,
  siPython,
  siRedis,
  siRust,
  siSentry,
  siSnowflake,
  siSqlite,
  siStripe,
  siSupabase,
  siTodoist,
  siTrello,
  siVercel,
  siYarn,
  siZapier,
  siBun,
  siCurl,
  siMake,
  siTerraform,
} from "simple-icons"
import { modelName } from "../lib/format"
import { familyOf, spanKind, toolFamily } from "../lib/span"
import type { Span } from "../lib/types"
import { BrandIcon } from "./BrandIcon"

// Claude Code's own tools have no official marks; each gets the glyph people
// already read that way: a file to read, a pencil to edit, a terminal for Bash.
const TOOLS: Record<string, LucideIcon> = {
  Read: FileText,
  Edit: FilePenLine,
  MultiEdit: FilePenLine,
  Write: FilePlus2,
  NotebookEdit: NotebookPen,
  Grep: TextSearch,
  Glob: FolderSearch,
  WebFetch: Globe,
  WebSearch: Globe,
  Bash: SquareTerminal,
  Agent: Bot,
  Task: Bot,
  Skill: WandSparkles,
  TodoWrite: ListTodo,
  AskUserQuestion: MessageCircleQuestion,
  ToolSearch: Wrench,
}

const KINDS: Record<string, LucideIcon> = {
  turn: MessageSquare,
  model: Sparkles,
  wait: Hourglass,
  run: Play,
  hook: Webhook,
  agent: Bot,
  span: Route,
}

// Official marks for the services connector (MCP) tools talk to.
const SERVICES: [RegExp, SimpleIcon][] = [
  [/linear/i, siLinear],
  [/github|ccd_pr|pull.?request/i, siGithub],
  [/gitlab/i, siGitlab],
  [/notion/i, siNotion],
  [/figma/i, siFigma],
  [/stripe/i, siStripe],
  [/sentry/i, siSentry],
  [/supabase/i, siSupabase],
  [/postgres|pg\b/i, siPostgresql],
  [/mysql/i, siMysql],
  [/sqlite/i, siSqlite],
  [/duckdb/i, siDuckdb],
  [/mongo/i, siMongodb],
  [/redis/i, siRedis],
  [/snowflake/i, siSnowflake],
  [/jira/i, siJira],
  [/confluence/i, siConfluence],
  [/asana/i, siAsana],
  [/trello/i, siTrello],
  [/todoist/i, siTodoist],
  [/airtable/i, siAirtable],
  [/obsidian/i, siObsidian],
  [/hubspot/i, siHubspot],
  [/zapier/i, siZapier],
  [/gmail/i, siGmail],
  [/calendar/i, siGooglecalendar],
  [/discord/i, siDiscord],
  [/vercel/i, siVercel],
  [/cloudflare/i, siCloudflare],
  [/docker/i, siDocker],
  [/kubernetes|k8s/i, siKubernetes],
  [/hugging/i, siHuggingface],
  [/chrome/i, siGooglechrome],
]

// Shell commands by the program they run: git, gh, npm, go, python...
const PROGRAMS: Record<string, SimpleIcon> = {
  git: siGit,
  gh: siGithub,
  npm: siNpm,
  npx: siNpm,
  pnpm: siPnpm,
  yarn: siYarn,
  bun: siBun,
  node: siNodedotjs,
  go: siGo,
  gofmt: siGo,
  python: siPython,
  python3: siPython,
  pip: siPython,
  pytest: siPython,
  uv: siPython,
  cargo: siRust,
  rustc: siRust,
  docker: siDocker,
  kubectl: siKubernetes,
  brew: siHomebrew,
  curl: siCurl,
  make: siMake,
  terraform: siTerraform,
  duckdb: siDuckdb,
  psql: siPostgresql,
  sqlite3: siSqlite,
}

// Model vendors by model id. OpenAI asked for its mark to be removed from
// open icon sets, so GPT models keep a neutral sparkle.
const MODELS: [RegExp, SimpleIcon][] = [
  [/claude|opus|sonnet|haiku|fable/i, siClaude],
  [/gemini|gemma/i, siGooglegemini],
  [/mistral|mixtral|codestral/i, siMistralai],
  [/llama/i, siMeta],
  [/sonar|perplexity/i, siPerplexity],
  [/ollama/i, siOllama],
]

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

function serverOf(span: Span): string {
  const a = span.attrs
  const t = String(a.tool_name || a["gen_ai.tool.name"] || "")
  return String(a["anthropic.mcp.server.name"] || span.joined?.["mcp_server.name"] || (t.startsWith("mcp__") ? t.split("__")[1] : "") || "")
}

function programOf(span: Span): string {
  const a = span.attrs
  const argv0 = String(a.bash_argv0 || "")
  if (argv0) return argv0
  const cmd = String(a.full_command || "").trim()
  // Skip setup like cd x && or VAR=1 to reach the program that does the work.
  const first = cmd.replace(/^(cd\s+\S+\s*(&&|;)\s*|[A-Za-z_]\w*=\S*\s+)+/, "").split(/\s+/)[0] || ""
  return first.split("/").pop() || ""
}

function modelOf(span: Span): string {
  const a = span.attrs
  return String(a.model || a["gen_ai.response.model"] || a["gen_ai.request.model"] || span.joined?.model || a["ai.model.id"] || "")
}

export function SpanIcon({ span }: { span: Span }) {
  const k = spanKind(span)
  if (k === "model") {
    const brand = MODELS.find(([re]) => re.test(modelOf(span)))?.[1]
    if (brand) return <BrandIcon icon={brand} />
  }
  if (k === "tool" || k === "agent") {
    const tool = String(span.attrs.tool_name || "")
    if (familyOf(span) === "mcp") {
      const server = serverOf(span)
      if (/slack/i.test(server)) return <Hash strokeWidth={1.75} aria-hidden />
      if (/browser|playwright|puppeteer/i.test(server)) return <Globe strokeWidth={1.75} aria-hidden />
      const brand = SERVICES.find(([re]) => re.test(server))?.[1]
      return brand ? <BrandIcon icon={brand} /> : <Plug strokeWidth={1.75} aria-hidden />
    }
    if (tool === "Bash") {
      const brand = PROGRAMS[programOf(span)]
      if (brand) return <BrandIcon icon={brand} />
    }
    const Icon = TOOLS[tool] || (k === "agent" ? Bot : Wrench)
    return <Icon strokeWidth={1.75} aria-hidden />
  }
  const Icon = KINDS[k] || Wrench
  return <Icon strokeWidth={1.75} aria-hidden />
}

// For places that name a service rather than a span (Connect, Apps).
export { BrandIcon }

// A model as people say it, with its maker's mark: "Opus 5.5" with Claude's.
export function ModelName({ model, size = 13 }: { model: string; size?: number }) {
  const brand = MODELS.find(([re]) => re.test(model))?.[1]
  return (
    <span className="model-name" title={model}>
      {brand ? <BrandIcon icon={brand} size={size} /> : <Sparkles size={size} strokeWidth={1.75} aria-hidden />}
      {modelName(model) || model}
    </span>
  )
}

// A Claude Code tool by name with its glyph: Read with a file, Bash with a terminal.
export function ToolName({ name, size = 13 }: { name: string; size?: number }) {
  let icon: React.ReactNode
  if (name.startsWith("mcp__")) {
    const server = name.split("__")[1] || ""
    const brand = SERVICES.find(([re]) => re.test(server))?.[1]
    icon = brand ? <BrandIcon icon={brand} size={size} /> : <Plug size={size} strokeWidth={1.75} aria-hidden />
  } else {
    const Icon = TOOLS[name] || Wrench
    icon = <Icon size={size} strokeWidth={1.75} aria-hidden />
  }
  const label = name.startsWith("mcp__") ? name.split("__").slice(2).join(" ").replace(/_/g, " ") : name
  return (
    <span className="tool-name" title={name}>
      {icon}
      {label}
    </span>
  )
}
