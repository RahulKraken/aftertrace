"use strict"

// Fail-closed identity: the Electron app version, GitHub tag, updater
// feed, and CHANGELOG heading must be the same number. v0.5.3 shipped
// with package.json 0.5.0, so installed apps never saw a newer feed.
// This is the check that would have caught it.

const fs = require("fs")
const path = require("path")

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

function parseSemver(s) {
  const m = String(s || "").trim().match(SEMVER)
  if (!m) return null
  return { raw: `${m[1]}.${m[2]}.${m[3]}`, major: +m[1], minor: +m[2], patch: +m[3] }
}

function cmpSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

function readPackageVersion(pkgPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
  const v = parseSemver(pkg.version)
  if (!v) throw new Error(`desktop/package.json version ${JSON.stringify(pkg.version)} is not X.Y.Z`)
  return v
}

function ymlVersion(text) {
  const m = String(text || "").match(/^version:\s*['"]?([0-9]+\.[0-9]+\.[0-9]+)/m)
  return m ? parseSemver(m[1]) : null
}

function tagVersion(ref) {
  const raw = String(ref || "")
  const m = raw.match(/refs\/tags\/v([0-9]+\.[0-9]+\.[0-9]+)$/) || raw.match(/^v([0-9]+\.[0-9]+\.[0-9]+)$/)
  return m ? parseSemver(m[1]) : null
}

function changelogHasVersion(markdown, version) {
  const re = new RegExp(`^## v${version.replace(/\./g, "\\.")}\\b`, "m")
  return re.test(String(markdown || ""))
}

function feedListsArm64Zip(text) {
  return /Aftertrace-mac-arm64\.zip/.test(String(text || ""))
}

function feedListsX64Zip(text) {
  return /Aftertrace-mac-x64\.zip/.test(String(text || ""))
}

function checkIdentity({
  packageVersion,
  githubRef,
  macYml,
  winYml,
  linuxYml,
  changelog,
  floorVersion,
} = {}) {
  const errors = []
  const pkg = parseSemver(packageVersion)
  if (!pkg) errors.push(`package version ${JSON.stringify(packageVersion)} is not X.Y.Z`)

  const tag = tagVersion(githubRef)
  if (tag && pkg && tag.raw !== pkg.raw) {
    errors.push(`tag v${tag.raw} does not match package.json ${pkg.raw}`)
  }
  if (tag && changelog != null && pkg && !changelogHasVersion(changelog, pkg.raw)) {
    errors.push(`CHANGELOG.md has no "## v${pkg.raw}" heading for this tag`)
  }

  const checkYml = (name, text) => {
    if (text == null || text === "") return
    const v = ymlVersion(text)
    if (!v) {
      errors.push(`${name} has no version: X.Y.Z`)
      return
    }
    if (pkg && v.raw !== pkg.raw) {
      errors.push(`${name} version ${v.raw} does not match package.json ${pkg.raw}`)
    }
  }
  checkYml("latest-mac.yml", macYml)
  checkYml("latest.yml", winYml)
  checkYml("latest-linux.yml", linuxYml)

  if (macYml) {
    if (!feedListsArm64Zip(macYml)) errors.push("latest-mac.yml must list Aftertrace-mac-arm64.zip")
    if (feedListsX64Zip(macYml)) errors.push("latest-mac.yml must not list Aftertrace-mac-x64.zip")
  }

  if (floorVersion && pkg) {
    const floor = parseSemver(floorVersion)
    if (floor && cmpSemver(pkg, floor) <= 0) {
      errors.push(
        `package.json ${pkg.raw} must be newer than ${floor.raw} so installed v0.5.3 (app 0.5.0) can see this feed`,
      )
    }
  }

  return { ok: errors.length === 0, errors, packageVersion: pkg && pkg.raw, tag: tag && tag.raw }
}

function loadRepo(root) {
  const pkgPath = path.join(root, "desktop", "package.json")
  const changelogPath = path.join(root, "CHANGELOG.md")
  return {
    packageVersion: readPackageVersion(pkgPath).raw,
    changelog: fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, "utf8") : "",
  }
}

function checkRepo(root, { githubRef, distDir, floorVersion = "0.5.0" } = {}) {
  const { packageVersion, changelog } = loadRepo(root)
  const read = (name) => {
    if (!distDir) return null
    const p = path.join(distDir, name)
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null
  }
  return checkIdentity({
    packageVersion,
    githubRef,
    changelog,
    macYml: read("latest-mac.yml"),
    winYml: read("latest.yml"),
    linuxYml: read("latest-linux.yml"),
    floorVersion,
  })
}

function assertOk(result) {
  if (result.ok) return result
  throw new Error(`release identity: ${result.errors.join("; ")}`)
}

if (require.main === module) {
  const root = path.join(__dirname, "..", "..")
  const dist = process.argv[2] ? path.resolve(process.argv[2]) : null
  const result = checkRepo(root, {
    githubRef: process.env.GITHUB_REF || "",
    distDir: dist,
  })
  if (!result.ok) {
    process.stderr.write(`${result.errors.join("\n")}\n`)
    process.exit(1)
  }
  process.stdout.write(`release identity ok ${result.packageVersion}\n`)
}

module.exports = {
  parseSemver,
  cmpSemver,
  ymlVersion,
  tagVersion,
  changelogHasVersion,
  checkIdentity,
  checkRepo,
  assertOk,
  readPackageVersion,
}
