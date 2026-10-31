"use strict"

const fs = require("fs")
const http = require("http")
const os = require("os")
const path = require("path")
const { spawn } = require("child_process")
const { engineLogPath, aftertraceDir, ENGINE_NAME } = require("./paths")
const { UI_ORIGIN } = require("./allowlist")

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000]
const HEALTHY_RESET_MS = 60_000
const STOP_GRACE_MS = 3000
const DEFAULT_WAIT_MS = 120_000

function backoffDelay(attempt) {
  const i = Math.max(0, Math.min(attempt, BACKOFF_MS.length - 1))
  return BACKOFF_MS[i]
}

function ping(origin, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let url
    try {
      url = new URL("/api/status", origin)
    } catch {
      resolve(false)
      return
    }
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on("error", () => resolve(false))
    req.on("timeout", () => {
      req.destroy()
      resolve(false)
    })
  })
}

function appendLog(file, chunk) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    let size = 0
    try {
      size = fs.statSync(file).size
    } catch {
      size = 0
    }
    if (size > 5 * 1024 * 1024) fs.writeFileSync(file, "")
    fs.appendFileSync(file, chunk)
  } catch {
    // logging must never take the engine down
  }
}

function createEngine(opts = {}) {
  const origin = opts.origin || UI_ORIGIN
  const pingFn = opts.ping || ping
  const spawnFn = opts.spawn || spawn
  let wakeSleep = null
  const sleepFn =
    opts.sleep ||
    ((ms) =>
      new Promise((r) => {
        const t = setTimeout(() => {
          wakeSleep = null
          r()
        }, ms)
        if (typeof t.unref === "function") t.unref()
        wakeSleep = () => {
          clearTimeout(t)
          wakeSleep = null
          r()
        }
      }))
  const logFile = opts.logFile || engineLogPath()
  const readyTimeoutMs = opts.readyTimeoutMs || DEFAULT_WAIT_MS
  let child = null
  let startedByUs = false
  let stopping = false
  let crashes = 0
  let runningLoop = null
  let state = "idle"
  let lastError = ""
  const listeners = new Set()

  function emit() {
    const snap = status()
    for (const fn of listeners) {
      try {
        fn(snap)
      } catch {
        // ignore
      }
    }
  }

  function status() {
    return {
      state,
      startedByUs,
      error: lastError,
      logPath: logFile,
      origin,
      crashes,
    }
  }

  async function healthy() {
    return pingFn(origin)
  }

  async function waitUntilHealthy(timeoutMs = readyTimeoutMs) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (stopping) return false
      if (await healthy()) {
        lastError = ""
        state = startedByUs && child ? "healthy" : "reused"
        emit()
        return true
      }
      await sleepFn(200)
    }
    lastError = lastError || `Engine did not become ready at ${origin}`
    if (state !== "restarting") {
      state = "error"
      emit()
    }
    return false
  }

  function wireChild(proc) {
    child = proc
    startedByUs = true
    const stamp = () => `\n[${new Date().toISOString()}]\n`
    if (proc.stdout) proc.stdout.on("data", (d) => appendLog(logFile, d))
    if (proc.stderr) proc.stderr.on("data", (d) => appendLog(logFile, d))
    proc.on("error", (err) => {
      lastError = err.message
      appendLog(logFile, `${stamp()}spawn error: ${err.stack || err}\n`)
    })
    proc.on("exit", (code, signal) => {
      appendLog(logFile, `${stamp()}exit code=${code} signal=${signal}\n`)
      child = null
      if (stopping) return
      crashes += 1
      state = "restarting"
      lastError = `Engine exited (${signal || code})`
      emit()
    })
  }

  function spawnEngine() {
    const bin = opts.bin
    if (!bin) {
      lastError = "Engine binary path is empty"
      state = "error"
      emit()
      return null
    }
    if (bin !== ENGINE_NAME && !fs.existsSync(bin)) {
      lastError = `Engine binary not found at ${bin}`
      state = "error"
      emit()
      return null
    }
    fs.mkdirSync(aftertraceDir(), { recursive: true })
    appendLog(logFile, `\n[${new Date().toISOString()}] starting ${bin} serve\n`)
    const proc = spawnFn(bin, opts.args || ["serve"], {
      cwd: os.homedir(),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    wireChild(proc)
    return proc
  }

  async function supervise() {
    while (!stopping) {
      if (await healthy()) {
        lastError = ""
        state = startedByUs && child ? "healthy" : "reused"
        emit()
        const since = Date.now()
        while (!stopping && (await healthy())) {
          if (Date.now() - since > HEALTHY_RESET_MS) crashes = 0
          await sleepFn(1000)
        }
        if (stopping) break
        // Listener went away. If we didn't start it, take over.
        continue
      }
      if (stopping) break
      if (!child) {
        state = crashes ? "restarting" : "starting"
        emit()
        if (crashes) await sleepFn(backoffDelay(crashes - 1))
        if (stopping) break
        if (await healthy()) continue
        spawnEngine()
        if (state === "error") {
          await sleepFn(backoffDelay(Math.max(0, crashes)))
          crashes += 1
          continue
        }
      }
      const ok = await waitUntilHealthy(readyTimeoutMs)
      if (!ok && !stopping) {
        if (child) {
          try {
            child.kill()
          } catch {
            // already gone
          }
        }
        crashes += 1
      }
    }
  }

  function start() {
    if (runningLoop) return runningLoop
    stopping = false
    runningLoop = supervise().catch((err) => {
      lastError = err.message
      state = "error"
      emit()
    })
    return runningLoop
  }

  function killChild(proc) {
    return new Promise((resolve) => {
      if (!proc) {
        resolve()
        return
      }
      let done = false
      const finish = () => {
        if (done) return
        done = true
        resolve()
      }
      proc.once("exit", finish)
      try {
        if (process.platform === "win32") proc.kill()
        else proc.kill("SIGTERM")
      } catch {
        finish()
        return
      }
      const t = setTimeout(() => {
        try {
          if (process.platform === "win32") proc.kill()
          else proc.kill("SIGKILL")
        } catch {
          // already gone
        }
        setTimeout(finish, 400)
      }, STOP_GRACE_MS)
      if (typeof t.unref === "function") t.unref()
    })
  }

  async function stop() {
    stopping = true
    if (wakeSleep) wakeSleep()
    const proc = child
    child = null
    if (startedByUs && proc) await killChild(proc)
    startedByUs = false
    const loop = runningLoop
    runningLoop = null
    if (loop) await loop.catch(() => {})
    state = "idle"
    emit()
  }

  function onStatus(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  return {
    start,
    stop,
    waitUntilHealthy,
    healthy,
    status,
    onStatus,
    backoffDelay,
  }
}

module.exports = { createEngine, backoffDelay, ping, BACKOFF_MS }
