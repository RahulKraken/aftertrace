"use strict"

// electron-builder notarizes and staples the .app, then wraps it in a DMG.
// Gatekeeper on a downloaded DMG checks the disk image, so the DMG itself
// has to be submitted to notarytool and stapled. Skip when secrets are absent.

const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")
const { canNotarize } = require("./mac-arch.cjs")

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" })
  return {
    status: r.status,
    text: `${r.stdout || ""}${r.stderr || ""}`,
  }
}

function notarytoolSubmitArgs(file) {
  if (process.env.APPLE_API_KEY) {
    return [
      "notarytool",
      "submit",
      file,
      "--wait",
      "--key",
      process.env.APPLE_API_KEY,
      "--key-id",
      process.env.APPLE_API_KEY_ID,
      "--issuer",
      process.env.APPLE_API_ISSUER,
    ]
  }
  return [
    "notarytool",
    "submit",
    file,
    "--wait",
    "--apple-id",
    process.env.APPLE_ID,
    "--password",
    process.env.APPLE_APP_SPECIFIC_PASSWORD,
    "--team-id",
    process.env.APPLE_TEAM_ID,
  ]
}

function notarizeAndStaple(file) {
  const submit = run("xcrun", notarytoolSubmitArgs(file))
  if (submit.status !== 0) {
    throw new Error(`notarytool submit failed for ${path.basename(file)}:\n${submit.text}`)
  }
  const staple = run("xcrun", ["stapler", "staple", file])
  if (staple.status !== 0) {
    throw new Error(`stapler staple failed for ${path.basename(file)}:\n${staple.text}`)
  }
}

function writeNotarizedMarker(outDir) {
  const marker = path.join(outDir, "Aftertrace-mac-notarized.json")
  fs.writeFileSync(marker, '{"notarized":true}\n')
  return marker
}

exports.default = async function afterAllArtifactBuild(buildResult) {
  if (process.platform !== "darwin") return []
  const paths = (buildResult && buildResult.artifactPaths) || []
  const dmgs = paths.filter((p) => p.endsWith(".dmg"))
  if (!dmgs.length) return []
  if (!canNotarize()) {
    process.stdout.write("DMG notarization skipped: signing or Apple credentials are not set.\n")
    return []
  }
  for (const dmg of dmgs) {
    process.stdout.write(`Notarizing and stapling ${path.basename(dmg)}\n`)
    notarizeAndStaple(dmg)
  }
  const outDir = (buildResult && buildResult.outDir) || path.dirname(dmgs[0])
  const marker = writeNotarizedMarker(outDir)
  process.stdout.write(`Wrote ${path.basename(marker)}\n`)
  return [marker]
}

exports.notarizeAndStaple = notarizeAndStaple
exports.writeNotarizedMarker = writeNotarizedMarker
exports.canNotarize = canNotarize
