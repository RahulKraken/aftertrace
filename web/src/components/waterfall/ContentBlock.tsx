import { useState } from "react"
import type { Content } from "../../lib/content"
import { CopyButton } from "../CopyButton"

const COLLAPSED_CHARS = 1200

export function ContentBlock({ label, content, note }: { label: string; content: Content | null; note?: string }) {
  const [open, setOpen] = useState(false)
  if (!content) {
    return (
      <div className="cblock">
        <div className="cblock-hd">
          <span className="h">{label}</span>
        </div>
        <div className="content-hidden">{note || "not captured"}</div>
      </div>
    )
  }
  const long = content.text.length > COLLAPSED_CHARS
  const shown = open || !long ? content.text : content.text.slice(0, COLLAPSED_CHARS) + "…"
  return (
    <div className="cblock">
      <div className="cblock-hd">
        <span className="h">{label}</span>
        <span className="mute num cblock-len">{content.text.length.toLocaleString()} chars</span>
        <CopyButton text={content.text} label="" done="Copied" className="icon-btn" />
      </div>
      <pre className={`cblock-body${content.json ? " is-json" : ""}`}>{shown}</pre>
      {long && (
        <button type="button" className="show-all" onClick={() => setOpen(!open)}>
          {open ? "show less" : `show all ${content.text.length.toLocaleString()} chars`}
        </button>
      )}
    </div>
  )
}
