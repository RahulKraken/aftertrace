import { Check, Circle } from "lucide-react"
import { CopyButton } from "./CopyButton"

const SETTINGS = `{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA": "1",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_TRACES_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "grpc",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://127.0.0.1:4317",
    "OTEL_LOG_TOOL_DETAILS": "1"
  }
}`

export function EmptyState() {
  return (
    <div className="empty-hero">
      <h1>Nothing on the wire yet</h1>
      <p>
        Aftertrace is listening on this machine. Point Claude Code at the local collector and the first turn will show up
        here.
      </p>
      <div className="checks">
        <div className="check on">
          <div className="check-icon">
            <Check size={13} />
          </div>
          <div className="body">
            <div className="t">Receiver is listening</div>
            <div className="d">OTLP on 127.0.0.1:4317 (gRPC) and :4318 (HTTP). This UI is up.</div>
          </div>
        </div>
        <div className="check">
          <div className="check-icon">
            <Circle size={10} />
          </div>
          <div className="body">
            <div className="t">Claude Code env not set</div>
            <div className="d">
              Add the exporters to <code>~/.claude/settings.json</code>. Managed settings can override a repo-local
              file, so the user one is the one that counts.
            </div>
          </div>
        </div>
        <div className="check">
          <div className="check-icon">
            <Circle size={10} />
          </div>
          <div className="body">
            <div className="t">Waiting for the first span</div>
            <div className="d">Send a prompt in Claude Code. A turn will land within a few seconds of export.</div>
          </div>
        </div>
      </div>
      <div className="recipe">
        <div
          className="h"
          style={{ fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--faint)" }}
        >
          Connect Claude Code
        </div>
        <ol>
          <li>
            <span>
              Paste this into <code>~/.claude/settings.json</code>. Keep <code>OTEL_LOG_TOOL_DETAILS=1</code> so
              skill, agent and MCP names stay real. Prompt text stays redacted at the source. Claude Code ignores these
              keys in a repository <code>.claude/settings.json</code>.
            </span>
            <CopyButton className="btn ghost copy-inline" text={SETTINGS} label="Copy settings.json" done="Copied" />
            <pre>{SETTINGS}</pre>
          </li>
          <li>Restart Claude Code, then send a prompt. This page will fill in.</li>
        </ol>
      </div>
    </div>
  )
}
