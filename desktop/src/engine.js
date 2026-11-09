"use strict"

const fs = require("fs")
const http = require("http")
const os = require("os")
const path = require("path")
const { spawn } = require("child_process")
const { engineLogPath, aftertraceDir, ENGINE_NAME } = require("./paths")
const { UI_ORIGIN } = require("./allowlist")
const { displayVersion } = require("./releaseVersion")
const { isForeignOccupant, occupantError, migrateLegacyService } = require("./foreignEngine")

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
      url = new URL("/api/health", origin)
    } catch {
      resolve(false)
      return
    }
    const req = http.get(url, { timeout: timeoutMs, agent: false }, (res) => {
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

function getJson(origin, pathname, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let url
    try {
      url = new URL(pathname, origin)
    } catch {
      resolve(null)
      return
    }
    const req = http.get(url, { timeout: timeoutMs, agent: false }, (res) => {
      let buf = ""
      res.on("data", (d) => {
        buf += d
        if (buf.length > 1_000_000) req.destroy()
      })
      res.on("end", () => {
        if (res.statusCode !== 200) {
          resolve(null)
          return
        }
        try {
          resolve(JSON.parse(buf))
        } catch {
          resolve(null)
        }
      })
    })
    req.on("error", () => resolve(null))
    req.on("timeout", () => {
      req.destroy()
      resolve(null)
    })
  })
}

function lockError(text) {
  const s = String(text || "")
  if (!/Conflicting lock is held/i.test(s) && !/Could not set lock/i.test(s)) return ""
  const pid = (s.match(/PID\s+(\d+)/i) || [])[1]
  const held = (s.match(/held in ([^\s(]+)/i) || [])[1]
  let msg = "Another Aftertrace is holding the database file."
  if (held) msg += ` Lock: ${held}`
  if (pid) msg += ` (PID ${pid})`
  msg += " The old login service will be stopped. Your data stays."
  return msg
}

async function probeOccupant(origin, getJsonFn = getJson, pingFn = ping) {
  const ver = await getJsonFn(origin, "/api/version")
  if (ver && (ver.version || ver.pid)) {
    return {
      version: ver.version || "unknown",
      service: ver.service || "",
      pid: ver.pid || null,
      bin: ver.bin || "",
    }
  }
  const st = await getJsonFn(origin, "/api/status")
  if (st && st.info) {
    return {
      version: st.info.version || "unknown",
      service: st.info.service || "",
      pid: null,
      bin: "",
    }
  }
  if (await pingFn(origin)) return { version: "unknown", service: "", pid: null, bin: "" }
  return null
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
  const getJsonFn = opts.getJson || getJson
  const isPackaged = Boolean(opts.isPackaged)
  const expectedVersion = opts.expectedVersion || ""
  const displace = opts.displace || migrateLegacyService
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
  let occupant = null
  let migrated = null
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
      occupant,
      migrated,
      expectedVersion: expectedVersion ? displayVersion(expectedVersion) : "",
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
        if (isPackaged && !(startedByUs && child)) {
          await sleepFn(200)
          continue
        }
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
    if (proc.stderr) {
      proc.stderr.on("data", (d) => {
        const text = String(d)
        appendLog(logFile, d)
        const lock = lockError(text)
        if (lock) {
          lastError = lock
          state = "error"
          emit()
        }
      })
    }
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
    const dataDir = aftertraceDir()
    fs.mkdirSync(dataDir, { recursive: true })
    appendLog(logFile, `\n[${new Date().toISOString()}] starting ${bin} serve\n`)
    const args = opts.args || ["serve", "--db", path.join(dataDir, "aftertrace.duckdb")]
    const proc = spawnFn(bin, args, {
      cwd: dataDir,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "", AFTERTRACE_HOME: dataDir },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    wireChild(proc)
    return proc
  }

  async function takeOverForeign() {
    if (startedByUs && child) return false
    const occ = await probeOccupant(origin, getJsonFn, pingFn)
    if (!occ) return false
    occupant = occ
    const foreign = isPackaged || isForeignOccupant(occ, expectedVersion)
    if (!foreign) return false
    lastError = occupantError(occ)
    state = "replacing"
    emit()
    try {
      migrated = await displace(occ)
    } catch (err) {
      migrated = { ok: false, error: err.message }
    }
    const start = Date.now()
    while (Date.now() - start < 8000) {
      if (!(await pingFn(origin))) return true
      await sleepFn(200)
    }
    if (await pingFn(origin)) {
      lastError =
        occupantError(occ) +
        (migrated && migrated.error ? ` ${migrated.error}` : " Stop it from Settings, or run aftertrace service uninstall.")
      state = "error"
      emit()
      return true
    }
    return true
  }

  async function supervise() {
    while (!stopping) {
      if (await takeOverForeign()) {
        if (state === "error") {
          await sleepFn(backoffDelay(crashes))
          crashes += 1
          continue
        }
      }
      if (await healthy()) {
        if (isPackaged && !(startedByUs && child)) {
          // Packaged app never silently attaches to a leftover CLI/launchd server.
          lastError = occupantError(occupant || { version: "unknown" })
          state = "error"
          emit()
          await sleepFn(1000)
          continue
        }
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

module.exports = {
  createEngine,
  backoffDelay,
  ping,
  getJson,
  lockError,
  probeOccupant,
  BACKOFF_MS,
}
