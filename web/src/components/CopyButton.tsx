import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { useToast } from "../lib/toast"

export function CopyButton({
  text,
  label = "Copy",
  done = "Copied",
  className = "btn ghost",
}: {
  text: string
  label?: string
  done?: string
  className?: string
}) {
  const toast = useToast()
  const [ok, setOk] = useState(false)
  return (
    <button
      type="button"
      className={className}
      onClick={async (e) => {
        e.stopPropagation()
        try {
          await navigator.clipboard.writeText(text)
        } catch {
          const ta = document.createElement("textarea")
          ta.value = text
          document.body.appendChild(ta)
          ta.select()
          document.execCommand("copy")
          ta.remove()
        }
        setOk(true)
        toast(done)
        window.setTimeout(() => setOk(false), 1600)
      }}
    >
      {ok ? <Check size={13} /> : <Copy size={13} />}
      {ok ? done : label}
    </button>
  )
}
