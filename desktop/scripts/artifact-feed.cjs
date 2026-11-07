"use strict"

// Identity of a packed dist/ against desktop/package.json and the updater
// feed. This reads real files (yml, zip, Info.plist). It is not a live
// signed-app upgrade and not a GUI test.

const crypto = require("crypto")
const fs = require("fs")
const path = require("path")
const {
  checkRepo,
  parseSemver,
  cmpSemver,
  ymlVersion,
  ymlSha512,
  findPackedApps,
  readAppShortVersion,
} = require("./release-identity.cjs")

function sha512Base64(file) {
  return crypto.createHash("sha512").update(fs.readFileSync(file)).digest("base64")
}

function checkDist(root, distDir, { floorVersion = "0.5.0" } = {}) {
  const errors = []
  const identity = checkRepo(root, { distDir, floorVersion })
  if (!identity.ok) errors.push(...identity.errors)

  const macYmlPath = path.join(distDir, "latest-mac.yml")
  const zipPath = path.join(distDir, "Aftertrace-mac-arm64.zip")
  const report = {
    packageVersion: identity.packageVersion,
    feedVersion: null,
    appVersions: [],
    zipShaOk: null,
    newerThanFloor: null,
  }

  if (fs.existsSync(macYmlPath)) {
    const yml = fs.readFileSync(macYmlPath, "utf8")
    const feed = ymlVersion(yml)
    report.feedVersion = feed && feed.raw
    const floor = parseSemver(floorVersion)
    if (feed && floor) report.newerThanFloor = cmpSemver(feed, floor) > 0
    if (fs.existsSync(zipPath)) {
      const expected = ymlSha512(yml, "Aftertrace-mac-arm64.zip")
      if (expected) {
        const got = sha512Base64(zipPath)
        report.zipShaOk = got === expected
        if (!report.zipShaOk) errors.push("latest-mac.yml sha512 does not match Aftertrace-mac-arm64.zip")
      }
    }
  }

  for (const app of findPackedApps(distDir)) {
    try {
      const v = readAppShortVersion(app)
      report.appVersions.push({ app, version: v })
    } catch (err) {
      errors.push(err.message)
    }
  }

  return { ok: errors.length === 0, errors, report }
}

if (require.main === module) {
  const root = path.join(__dirname, "..", "..")
  const dist = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "desktop", "dist")
  if (!fs.existsSync(dist)) {
    process.stderr.write(`artifact-feed: missing ${dist}\n`)
    process.exit(1)
  }
  const result = checkDist(root, dist)
  process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`)
  if (!result.ok) {
    process.stderr.write(`${result.errors.join("\n")}\n`)
    process.exit(1)
  }
  process.stdout.write("artifact-feed ok\n")
}

module.exports = { checkDist, sha512Base64 }
