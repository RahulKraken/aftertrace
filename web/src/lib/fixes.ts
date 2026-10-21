import { dur } from "./format"
import type { Finding } from "./types"

export const WIN_MS = 1500

export type Win = {
  figure: number
  label: string
  saved?: string
}

export type Fix = {
  label: string
  snippet: string
  win: Win
}

function savedFrom(f: Finding): string | undefined {
  if (f.impact_unit.startsWith("USD") || f.impact_unit === "sessions") return undefined
  return dur(f.impact_value * 1000)
}

function countFrom(f: Finding, re: RegExp, fallback = 0): number {
  const m = f.headline.match(re)
  return m ? Number(m[1]) : fallback
}

export function rankHero(open: Finding[]): Finding | null {
  if (!open.length) return null
  return [...open].sort((a, b) => {
    const ra = a.rule_id === "permission.allow_rule_candidate" ? 0 : 1
    const rb = b.rule_id === "permission.allow_rule_candidate" ? 0 : 1
    if (ra !== rb) return ra - rb
    return b.impact_value - a.impact_value
  })[0]
}

export function fixFor(f: Finding): Fix | null {
  if (f.rule_id === "permission.allow_rule_candidate") {
    const m = f.headline.match(/Bash\(([^)]+)\)/)
    const rule = m ? `Bash(${m[1]})` : "Bash(*)"
    const n = countFrom(f, /(\d+)\s+permission prompts/)
    return {
      label: "Copy allow rule",
      snippet: `{
  "permissions": {
    "allow": ["${rule}"]
  }
}`,
      win: {
        figure: n,
        label: n === 1 ? "prompt removed" : "prompts removed",
        saved: savedFrom(f),
      },
    }
  }
  if (f.rule_id === "retry.exhausted") {
    const n = countFrom(f, /after (\d+) attempts/, 11)
    return {
      label: "Copy retry env",
      snippet: `export CLAUDE_CODE_MAX_RETRIES=15
export CLAUDE_CODE_RETRY_WATCHDOG=1`,
      win: {
        figure: n,
        label: "retries, then it stopped",
        saved: savedFrom(f),
      },
    }
  }
  if (f.rule_id === "plugin.skills_unused") {
    const n = countFrom(f, /(\d+)\s+sessions/, 4)
    return {
      label: "Copy disable snippet",
      snippet: `{
  "enabledPlugins": {
    "release-notes@example-marketplace": false
  }
}`,
      win: {
        figure: n,
        label: "sessions, plugin never used",
      },
    }
  }
  if (f.rule_id === "hook.overhead") {
    return {
      label: "Copy hook matcher",
      snippet: `{
  "hooks": {
    "PreToolUse": [{ "matcher": "Bash", "hooks": [] }]
  }
}`,
      win: {
        figure: Math.max(1, Math.round(f.impact_value / 60)),
        label: "min of hook tax, narrowed",
      },
    }
  }
  if (f.rule_id === "tool.repeated_errors") {
    const n = countFrom(f, /failed (\d+) times/, 6)
    return {
      label: "Copy CLAUDE.md note",
      snippet: `## pytest
Run from the repo root: pytest tests/unit -x
Deps: npm ci && pip install -e .[dev]`,
      win: {
        figure: n,
        label: "failing runs, recorded once",
        saved: savedFrom(f),
      },
    }
  }
  return null
}
