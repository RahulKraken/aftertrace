"use strict"

// electron-builder signs the .apps (CSC_*). This hook notarizes DMGs one at
// a time (arm64 first). Consumer Mac is Apple silicon: default
// NOTARIZE_MAC_ARCHES=arm64. electron-builder mac.notarize stays off.
// Two parallel waits stayed In Progress for 60 minutes (PR 44,
// run 42235990924). Skip when secrets are absent.

const fs = require("fs")
const path = require("path")
const { spawn, spawnSync } = require("child_process")
const { canNotarize } = require("./mac-arch.cjs")

const NOTARY_WAIT_SECONDS = 5400

function notaryAuthArgs() {
  if (process.env.APPLE_API_KEY) {
    return [
      "--key",
      process.env.APPLE_API_KEY,
      "--key-id",
      process.env.APPLE_API_KEY_ID,
      "--issuer",
      process.env.APPLE_API_ISSUER,
    ]
  }
  return [
    "--apple-id",
    process.env.APPLE_ID,
    "--password",
    process.env.APPLE_APP_SPECIFIC_PASSWORD,
    "--team-id",
    process.env.APPLE_TEAM_ID,
  ]
}

function notarytoolSubmitArgs(file) {
  return ["notarytool", "submit", file, "--output-format", "json"].concat(notaryAuthArgs())
}

function notarytoolWaitArgs(id) {
  return ["notarytool", "wait", id, "--timeout", String(NOTARY_WAIT_SECONDS)].concat(notaryAuthArgs())
}

function parseNotarizeArches(raw) {
  const source = raw == null ? process.env.NOTARIZE_MAC_ARCHES : raw
  if (source == null) return ["arm64"]
  return String(source)
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x === "arm64" || x === "x64")
}

function collectNotarizeTargets(artifactPaths, arches) {
  const want = new Set(arches || parseNotarizeArches())
  const byArch = { arm64: null, x64: null }
  for (const p of artifactPaths || []) {
    const base = path.basename(p)
    const m = base.match(/^Aftertrace-mac-(arm64|x64)\.dmg$/)
    if (!m || !want.has(m[1]) || byArch[m[1]]) continue
    byArch[m[1]] = p
  }
  return ["arm64", "x64"].filter((a) => byArch[a]).map((a) => byArch[a])
}

function collectAppBundles(outDir) {
  if (!outDir) return []
  const apps = []
  let names
  try {
    names = fs.readdirSync(outDir)
  } catch {
    return []
  }
  for (const name of names) {
    const app = path.join(outDir, name, "Aftertrace.app")
    if (fs.existsSync(path.join(app, "Contents"))) apps.push(app)
  }
  return apps
}

function parseNotaryId(text) {
  const trimmed = String(text || "").trim()
  const jsonStart = trimmed.indexOf("{")
  const json = jsonStart >= 0 ? trimmed.slice(jsonStart) : trimmed
  let parsed
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error(`notarytool submit did not return JSON: ${trimmed.slice(0, 200)}`)
  }
  const id = parsed && parsed.id
  if (!id) throw new Error(`notarytool submit JSON missing id: ${trimmed.slice(0, 200)}`)
  return id
}

function spawnCapture(cmd, args, spawnFn) {
  return new Promise((resolve, reject) => {
    const child = spawnFn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    let err = ""
    if (child.stdout && typeof child.stdout.on === "function") {
      child.stdout.on("data", (d) => {
        out += d
      })
    }
    if (child.stderr && typeof child.stderr.on === "function") {
      child.stderr.on("data", (d) => {
        err += d
      })
    }
    child.on("error", reject)
    child.on("close", (status, signal) => {
      if (status === 0) resolve(out)
      else {
        const why = signal ? `signal ${signal}` : `exit ${status}`
        reject(new Error(`${cmd} ${args[0] || ""} ${why}: ${err || out}`))
      }
    })
  })
}

function spawnInherit(cmd, args, spawnFn) {
  return new Promise((resolve, reject) => {
    const child = spawnFn(cmd, args, { stdio: "inherit" })
    child.on("error", reject)
    child.on("close", (status, signal) => {
      if (status === 0) resolve()
      else {
        const why = signal ? `signal ${signal}` : `exit ${status}`
        reject(new Error(`${cmd} ${args[0] || ""} ${why}`))
      }
    })
  })
}

function isStaplerTransient(text) {
  const s = String(text || "")
  return (
    /NSURLErrorDomain Code=-1005/.test(s) ||
    /The network connection was lost/i.test(s) ||
    /The staple and validate action failed! Error 68/.test(s)
  )
}

function defaultSleep(ms) {
  spawnSync("sleep", [String(Math.max(1, Math.ceil(Number(ms) / 1000)))])
}

function stapleFile(file, spawnSyncFn, { retries = 5, sleep = defaultSleep } = {}) {
  let last = ""
  for (let attempt = 1; attempt <= retries; attempt++) {
    const r = spawnSyncFn("xcrun", ["stapler", "staple", file], { encoding: "utf8" })
    if (r.status === 0) return
    last = `${r.stdout || ""}${r.stderr || ""}`
    if (!isStaplerTransient(last) || attempt === retries) {
      throw new Error(`stapler staple failed for ${path.basename(file)}:\n${last}`)
    }
    process.stdout.write(
      `stapler staple retry ${attempt}/${retries - 1} after CloudKit drop (${path.basename(file)})\n`,
    )
    sleep(Math.min(2000 * 2 ** (attempt - 1), 16000))
  }
}

async function notarizeFiles(files, spawnFn) {
  for (const file of files) {
    process.stdout.write(`notarytool submit ${path.basename(file)}\n`)
    let id
    try {
      const out = await spawnCapture("xcrun", notarytoolSubmitArgs(file), spawnFn)
      id = parseNotaryId(out)
      process.stdout.write(`notarytool submission ${id} for ${path.basename(file)}\n`)
    } catch (err) {
      throw new Error(`notarytool submit failed for ${path.basename(file)}: ${err.message}`)
    }
    process.stdout.write(`notarytool wait ${id} (${path.basename(file)})\n`)
    try {
      await spawnInherit("xcrun", notarytoolWaitArgs(id), spawnFn)
    } catch (err) {
      throw new Error(`notarytool wait failed for ${path.basename(file)} (${id}): ${err.message}`)
    }
  }
}

function writeNotarizedMarker(outDir, writeFileSyncFn = fs.writeFileSync) {
  const marker = path.join(outDir, "Aftertrace-mac-notarized.json")
  writeFileSyncFn(marker, '{"notarized":true}\n')
  return marker
}

function defaultIo() {
  return {
    spawn,
    spawnSync,
    canNotarize,
    writeFileSync: fs.writeFileSync,
    platform: process.platform,
  }
}

function isNotaryWaitTimeout(err) {
  const msg = err && err.message ? String(err.message) : String(err)
  return /exit 124/.test(msg) || /Timeout of \d+ second/.test(msg)
}

function requireMacNotarize() {
  const v = process.env.REQUIRE_MAC_NOTARIZE
  return v === "true" || v === "1"
}

async function afterAllArtifactBuild(buildResult, io) {
  const hooks = { ...defaultIo(), ...io }
  if (hooks.platform !== "darwin") return []
  const paths = (buildResult && buildResult.artifactPaths) || []
  const targets = collectNotarizeTargets(paths)
  if (!targets.length) return []
  if (!hooks.canNotarize()) {
    process.stdout.write("DMG notarization skipped: signing or Apple credentials are not set.\n")
    return []
  }
  try {
    await notarizeFiles(targets, hooks.spawn)
  } catch (err) {
    // PRs may keep signed artifacts if Apple stays In Progress. A GitHub
    // Release must not: REQUIRE_MAC_NOTARIZE fails closed (no marker, no
    // publish). Never write Aftertrace-mac-notarized.json on timeout.
    if (isNotaryWaitTimeout(err) && !requireMacNotarize()) {
      process.stdout.write(
        `notarytool wait timed out; PR artifacts stay signed without staple. ${err.message}\n`,
      )
      return []
    }
    throw err
  }
  const outDir = (buildResult && buildResult.outDir) || path.dirname(targets[0])
  for (const file of targets) {
    process.stdout.write(`stapler staple ${path.basename(file)}\n`)
    stapleFile(file, hooks.spawnSync)
  }
  const marker = writeNotarizedMarker(outDir, hooks.writeFileSync)
  process.stdout.write(`Wrote ${path.basename(marker)}\n`)
  return [marker]
}

exports.default = afterAllArtifactBuild
exports.afterAllArtifactBuild = afterAllArtifactBuild
exports.notarizeFiles = notarizeFiles
exports.notarytoolSubmitArgs = notarytoolSubmitArgs
exports.notarytoolWaitArgs = notarytoolWaitArgs
exports.collectNotarizeTargets = collectNotarizeTargets
exports.parseNotarizeArches = parseNotarizeArches
exports.collectAppBundles = collectAppBundles
exports.parseNotaryId = parseNotaryId
exports.writeNotarizedMarker = writeNotarizedMarker
exports.stapleFile = stapleFile
exports.isStaplerTransient = isStaplerTransient
exports.canNotarize = canNotarize
exports.isNotaryWaitTimeout = isNotaryWaitTimeout
exports.requireMacNotarize = requireMacNotarize
exports.NOTARY_WAIT_SECONDS = NOTARY_WAIT_SECONDS
