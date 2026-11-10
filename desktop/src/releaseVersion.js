"use strict"

// One display form for the release tag: vX.Y.Z. package.json and the
// updater feed stay X.Y.Z (electron-updater). The Go sidecar ldflags and
// every UI surface use the v-prefixed tag.

function numericVersion(raw) {
  return String(raw || "")
    .trim()
    .replace(/^v/i, "")
}

function displayVersion(raw) {
  const n = numericVersion(raw)
  return n ? `v${n}` : ""
}

function versionsMatch(a, b) {
  const x = numericVersion(a)
  const y = numericVersion(b)
  return Boolean(x) && x === y
}

module.exports = { numericVersion, displayVersion, versionsMatch }
