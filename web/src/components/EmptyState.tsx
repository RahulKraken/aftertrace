import { ArrowRight, Check } from "lucide-react"
import { siClaude } from "simple-icons"
import { Link } from "wouter"
import { BrandIcon } from "./BrandIcon"
import { CopyButton } from "./CopyButton"
import { Logo } from "./Logo"

// The first thing a new person sees. Visible system status (it is running),
// one obvious next step (connect), feedback that it is listening, and a way
// to look around before connecting anything.
export function EmptyState() {
  return (
    <div className="welcome">
      <div className="welcome-mark">
        <Logo size={30} />
      </div>
      <h1>Welcome to Aftertrace</h1>
      <p className="welcome-lede">
        It's running on this machine and nothing leaves it. Connect Claude Code, or any app that speaks OpenTelemetry, and
        your first turn shows up here as it happens.
      </p>

      <ol className="welcome-steps">
        <li className="is-done">
          <span className="ws-node">
            <Check size={13} strokeWidth={2.5} />
          </span>
          <div>
            <div className="ws-t">Aftertrace is running</div>
            <div className="ws-d">Listening on 127.0.0.1 for traces, logs and metrics.</div>
          </div>
        </li>
        <li>
          <span className="ws-node">2</span>
          <div>
            <div className="ws-t">Connect a source</div>
            <div className="ws-d">One block in your Claude Code settings, or a few lines in your app.</div>
            <Link href="/connect" className="btn welcome-cta">
              <BrandIcon icon={siClaude} size={14} mono />
              Connect Claude Code
              <ArrowRight size={14} />
            </Link>
          </div>
        </li>
        <li className="is-waiting">
          <span className="ws-node">
            <i className="live-dot" />
          </span>
          <div>
            <div className="ws-t">Send a prompt</div>
            <div className="ws-d">Listening for your first span. This page fills in by itself.</div>
          </div>
        </li>
      </ol>

      <div className="welcome-demo">
        <span>Just looking around? Load synthetic sessions and apps:</span>
        <code>aftertrace demo</code>
        <CopyButton className="btn ghost copy-inline" text="aftertrace demo" label="Copy" done="Copied" />
      </div>
    </div>
  )
}
