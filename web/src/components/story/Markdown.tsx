import type { ReactNode } from "react"

// Just enough Markdown for Claude's replies: paragraphs, lists, headings,
// `code`, **bold** and [links](https://…). Built as React nodes, never as HTML.
const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g

function inline(s: string, key: string): ReactNode[] {
  return s.split(INLINE).map((part, i) => {
    const k = `${key}-${i}`
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1) return <code key={k}>{part.slice(1, -1)}</code>
    if (part.startsWith("**") && part.endsWith("**") && part.length > 3) return <strong key={k}>{part.slice(2, -2)}</strong>
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/)
    if (link)
      return (
        <a key={k} href={link[2]} target="_blank" rel="noreferrer">
          {link[1]}
        </a>
      )
    return part
  })
}

export function MarkdownInline({ text }: { text: string }) {
  return <>{inline(text, "i")}</>
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const lines = text.replace(/\r/g, "").split("\n")
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(" "), `p${blocks.length}`)}</p>)
    para = []
    if (list) {
      const items = list.items.map((it, i) => <li key={i}>{inline(it, `l${blocks.length}-${i}`)}</li>)
      blocks.push(list.ordered ? <ol key={`l${blocks.length}`}>{items}</ol> : <ul key={`l${blocks.length}`}>{items}</ul>)
    }
    list = null
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/)
    const head = line.match(/^#{1,6}\s+(.*)$/)
    if (!line.trim()) {
      flush()
    } else if (head) {
      flush()
      blocks.push(
        <div key={`h${blocks.length}`} className="md-h">
          {inline(head[1], `h${blocks.length}`)}
        </div>,
      )
    } else if (bullet || num) {
      const ordered = Boolean(num && !bullet)
      if (para.length || (list && list.ordered !== ordered)) flush()
      if (!list) list = { ordered, items: [] }
      list.items.push((bullet || num)![1])
    } else if (list && /^\s{2,}/.test(raw)) {
      list.items[list.items.length - 1] += " " + line.trim()
    } else {
      if (list) flush()
      para.push(line.trim())
    }
  }
  flush()
  return <div className="md">{blocks}</div>
}
