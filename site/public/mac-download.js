/* Chip-aware Mac download + hide the Gatekeeper note once a notarized
   build is on GitHub Releases. No-JS keeps Aftertrace-mac.dmg (arm64 alias). */
(function (root) {
  "use strict"

  var RELEASE = "https://github.com/RahulKraken/aftertrace/releases/latest/download"
  var API = "https://api.github.com/repos/RahulKraken/aftertrace/releases/latest"
  var NOTARIZED_ASSET = "Aftertrace-mac-notarized.json"

  function detectMacChip(nav) {
    if (!nav) return "arm64"
    var high = nav.__architecture || (nav.userAgentData && nav.userAgentData.architecture)
    if (high && /arm/i.test(high)) return "arm64"
    if (high && /x86|amd64|x64/i.test(high)) return "x64"
    var gpu = nav.__gpuRenderer || ""
    if (/Apple\s+M\d|Apple GPU/i.test(gpu)) return "arm64"
    if (/Intel/i.test(gpu) || /AMD|Radeon/i.test(gpu)) return "x64"
    return "arm64"
  }

  function readGpuRenderer() {
    try {
      var canvas = document.createElement("canvas")
      var gl = canvas.getContext("webgl")
      if (!gl) return ""
      var info = gl.getExtension("WEBGL_debug_renderer_info")
      if (!info) return ""
      return gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || ""
    } catch (e) {
      return ""
    }
  }

  function detectMacChipAsync(nav) {
    nav = nav || (typeof navigator !== "undefined" ? navigator : null)
    var p = Promise.resolve()
    if (nav && nav.userAgentData && typeof nav.userAgentData.getHighEntropyValues === "function") {
      p = nav.userAgentData.getHighEntropyValues(["architecture"]).then(function (v) {
        nav.__architecture = v && v.architecture
      }).catch(function () {})
    }
    return p.then(function () {
      if (nav && !nav.__gpuRenderer) nav.__gpuRenderer = readGpuRenderer()
      return detectMacChip(nav)
    })
  }

  function hrefFor(chip) {
    return RELEASE + "/Aftertrace-mac-" + chip + ".dmg"
  }

  function otherLabel(chip) {
    return chip === "x64" ? "Download for Intel Mac" : "Download for Apple silicon"
  }

  function apply(doc, chip) {
    if (!doc) return
    var primary = doc.getElementById("mac-download")
    var other = doc.getElementById("mac-download-other")
    var start = doc.getElementById("mac-start")
    if (!chip) chip = "arm64"
    var otherChip = chip === "arm64" ? "x64" : "arm64"
    if (primary) primary.setAttribute("href", hrefFor(chip))
    if (start) start.setAttribute("href", hrefFor(chip))
    if (other) {
      other.setAttribute("href", hrefFor(otherChip))
      other.textContent = otherLabel(otherChip)
    }
  }

  function hideOpenNotes(doc) {
    if (!doc) return
    doc.querySelectorAll(".open-note").forEach(function (el) {
      el.hidden = true
    })
  }

  function hideOpenNotesIfNotarized(doc, fetchFn) {
    var run = fetchFn || (typeof fetch === "function" ? fetch : null)
    if (!run) return Promise.resolve(false)
    return run(API).then(function (r) {
      return r && r.ok ? r.json() : null
    }).then(function (rel) {
      var names = ((rel && rel.assets) || []).map(function (a) { return a.name })
      if (names.indexOf(NOTARIZED_ASSET) >= 0) {
        hideOpenNotes(doc)
        return true
      }
      return false
    }).catch(function () { return false })
  }

  function boot(doc, nav) {
    return detectMacChipAsync(nav).then(function (chip) {
      apply(doc, chip)
      return hideOpenNotesIfNotarized(doc)
    })
  }

  var api = {
    RELEASE: RELEASE,
    NOTARIZED_ASSET: NOTARIZED_ASSET,
    detectMacChip: detectMacChip,
    detectMacChipAsync: detectMacChipAsync,
    hrefFor: hrefFor,
    otherLabel: otherLabel,
    apply: apply,
    hideOpenNotesIfNotarized: hideOpenNotesIfNotarized,
    boot: boot,
  }
  root.AftertraceMacDownload = api

  if (typeof document !== "undefined" && document.readyState) {
    var start = function () { boot(document, typeof navigator !== "undefined" ? navigator : null) }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start)
    else start()
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
