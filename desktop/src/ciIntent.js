"use strict"

// Smoke file-protocol, userData relocate, and the 127.0.0.1 generic feed
// override are CI/test hooks packed into the shipping asar. They must not
// arm for a normal user who happens to have an env var set, and they are
// not reachable from engine HTTP, the dashboard origin, or IPC.

function ciIntent(env = process.env) {
  if (env.AFTERTRACE_SMOKE_ALLOW === "1") return true
  return env.GITHUB_ACTIONS === "true" && Boolean(env.RUNNER_TEMP || env.GITHUB_WORKSPACE)
}

module.exports = { ciIntent }
