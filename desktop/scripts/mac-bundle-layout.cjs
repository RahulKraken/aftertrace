"use strict"

// Mac .app Contents/ is a sealed code directory. Loose files there (LICENSE,
// README, …) are nested "code" to codesign and fail with
// "code object is not signed at all / In subcomponent: …/Contents/LICENSE".
// Resources/ is the right place for data files.

const fs = require("fs")
const path = require("path")

const ALLOWED_CONTENTS_FILES = new Set(["Info.plist", "PkgInfo", "CodeResources"])
const ALLOWED_CONTENTS_DIRS = new Set([
  "MacOS",
  "Resources",
  "Frameworks",
  "PlugIns",
  "SharedSupport",
  "XPCServices",
  "Helpers",
  "Library",
  "_CodeSignature",
])

function inspectContents(contentsDir) {
  const unexpectedFiles = []
  const unexpectedDirs = []
  if (!fs.existsSync(contentsDir)) {
    return { unexpectedFiles, unexpectedDirs, entries: [] }
  }
  const entries = fs.readdirSync(contentsDir, { withFileTypes: true })
  for (const ent of entries) {
    if (ent.name === ".DS_Store") continue
    if (ent.isDirectory()) {
      if (!ALLOWED_CONTENTS_DIRS.has(ent.name)) unexpectedDirs.push(ent.name)
    } else if (ent.isFile() || ent.isSymbolicLink()) {
      if (!ALLOWED_CONTENTS_FILES.has(ent.name)) unexpectedFiles.push(ent.name)
    } else {
      unexpectedFiles.push(ent.name)
    }
  }
  return { unexpectedFiles, unexpectedDirs, entries: entries.map((e) => e.name) }
}

function licensePathFor(electronPlatformName, appRoot) {
  if (electronPlatformName === "darwin") {
    return path.join(appRoot, "Contents", "Resources", "LICENSE")
  }
  return path.join(appRoot, "resources", "LICENSE")
}

function assertMacBundleLayout(appBundle) {
  const contents = path.join(appBundle, "Contents")
  const { unexpectedFiles, unexpectedDirs } = inspectContents(contents)
  const problems = []
  if (unexpectedFiles.length) {
    problems.push(
      `unsigned nested files at Contents/ (codesign will fail): ${unexpectedFiles.join(", ")}. Put data in Contents/Resources/.`,
    )
  }
  if (unexpectedDirs.length) {
    problems.push(`unexpected directories at Contents/: ${unexpectedDirs.join(", ")}`)
  }
  const license = licensePathFor("darwin", appBundle)
  if (!isNonEmptyFile(license)) {
    problems.push(`Apache LICENSE missing at ${license}`)
  }
  const strayLicense = path.join(contents, "LICENSE")
  if (fs.existsSync(strayLicense)) {
    problems.push(`LICENSE must not sit at Contents/LICENSE (v0.5.1 codesign failure). Use Contents/Resources/LICENSE.`)
  }
  if (problems.length) {
    throw new Error(`Mac bundle layout invalid for ${appBundle}:\n- ${problems.join("\n- ")}`)
  }
}

function isNonEmptyFile(p) {
  try {
    const st = fs.statSync(p)
    return st.isFile() && st.size > 0
  } catch {
    return false
  }
}

function assertPackagedLicense(electronPlatformName, appRoot) {
  const license = licensePathFor(electronPlatformName, appRoot)
  if (!isNonEmptyFile(license)) {
    throw new Error(`Apache LICENSE missing from package at ${license}`)
  }
}

module.exports = {
  ALLOWED_CONTENTS_FILES,
  ALLOWED_CONTENTS_DIRS,
  inspectContents,
  licensePathFor,
  assertMacBundleLayout,
  assertPackagedLicense,
}
