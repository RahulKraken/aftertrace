"use strict"

// After electron-builder, make sure GitHub Release / site download names exist:
//   Aftertrace-mac-arm64.dmg / Aftertrace-mac-x64.dmg (and zips)
//   Aftertrace-mac.dmg  (copy of the arm64 DMG, so /releases/latest/download/Aftertrace-mac.dmg stays valid)
//   Aftertrace-win.exe, Aftertrace-linux.AppImage, Aftertrace-linux.deb
// plus versioned copies and latest-mac.yml / latest.yml
// so electron-updater can pick the zip that matches the machine's chip.

const crypto = require("crypto")
const fs = require("fs")
const path = require("path")

const MAC_ARCHES = ["arm64", "x64"]

function sha512Base64(file) {
  const buf = fs.readFileSync(file)
  return { sha512: crypto.createHash("sha512").update(buf).digest("base64"), size: buf.length }
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile())
}

function copyFile(src, dest) {
  if (path.resolve(src) === path.resolve(dest)) return
  fs.copyFileSync(src, dest)
}

function rewriteAll(text, from, to) {
  if (!from || from === to) return text
  return text.split(from).join(to)
}

function writeLatestYml(outDir, ymlName, version, fileName) {
  const { sha512, size } = sha512Base64(path.join(outDir, fileName))
  const body =
    `version: ${version}\n` +
    `files:\n` +
    `  - url: ${fileName}\n` +
    `    sha512: ${sha512}\n` +
    `    size: ${size}\n` +
    `path: ${fileName}\n` +
    `sha512: ${sha512}\n` +
    `releaseDate: '${new Date().toISOString()}'\n`
  fs.writeFileSync(path.join(outDir, ymlName), body)
}

function pick(files, pred) {
  return files.find(pred) || null
}

function ensureStable(outDir, files, { kind, ext, match }) {
  const stable = `Aftertrace-${kind}.${ext}`
  const stablePath = path.join(outDir, stable)
  if (fs.existsSync(stablePath)) return { stable, original: stable }
  const original = pick(files, match)
  if (!original) return null
  copyFile(path.join(outDir, original), stablePath)
  return { stable, original }
}

function versionedName(version, kind, ext) {
  return `Aftertrace-${version}-${kind}.${ext}`
}

function macKind(arch) {
  return `mac-${arch}`
}

function findMacArtifact(outDir, files, arch, ext) {
  const stable = `Aftertrace-${macKind(arch)}.${ext}`
  const stablePath = path.join(outDir, stable)
  if (fs.existsSync(stablePath)) return { stable, original: stable }
  const original = pick(files, (f) => {
    if (!f.endsWith(`.${ext}`)) return false
    if (f.endsWith(".blockmap")) return false
    if (f.includes("universal")) return false
    // Match this chip only (Aftertrace-mac-arm64.dmg, Aftertrace-0.5.0-arm64.dmg, …).
    const lower = f.toLowerCase()
    if (arch === "arm64") return lower.includes("arm64")
    return (lower.includes("x64") || lower.includes("amd64") || lower.includes("x86_64")) && !lower.includes("arm64")
  })
  if (!original) return null
  copyFile(path.join(outDir, original), stablePath)
  return { stable, original }
}

function writeMacLatestYml(outDir, version) {
  const entries = MAC_ARCHES.map((arch) => {
    const fileName = `Aftertrace-${macKind(arch)}.zip`
    const { sha512, size } = sha512Base64(path.join(outDir, fileName))
    return { url: fileName, sha512, size }
  })
  const primary = entries[0]
  const body =
    `version: ${version}\n` +
    `files:\n` +
    entries
      .map((e) => `  - url: ${e.url}\n    sha512: ${e.sha512}\n    size: ${e.size}\n`)
      .join("") +
    `path: ${primary.url}\n` +
    `sha512: ${primary.sha512}\n` +
    `releaseDate: '${new Date().toISOString()}'\n`
  fs.writeFileSync(path.join(outDir, "latest-mac.yml"), body)
}

function stabilizeMac(outDir, files, version, made, missing) {
  const byArch = {}
  for (const arch of MAC_ARCHES) {
    const dmg = findMacArtifact(outDir, files, arch, "dmg")
    const zip = findMacArtifact(outDir, files, arch, "zip")
    if (!dmg) missing.push(`Aftertrace-${macKind(arch)}.dmg`)
    if (!zip) missing.push(`Aftertrace-${macKind(arch)}.zip`)
    byArch[arch] = { dmg, zip }
    if (dmg) {
      const vname = versionedName(version, macKind(arch), "dmg")
      copyFile(path.join(outDir, dmg.stable), path.join(outDir, vname))
      made.push(dmg.stable, vname)
    }
    if (zip) {
      const vname = versionedName(version, macKind(arch), "zip")
      copyFile(path.join(outDir, zip.stable), path.join(outDir, vname))
      made.push(zip.stable, vname)
      const zipBlock = pick(
        files,
        (f) =>
          f === `${zip.original}.blockmap` ||
          f === `${zip.stable}.blockmap` ||
          (f.endsWith(".zip.blockmap") && f.includes(arch)),
      )
      if (zipBlock) {
        const stableBlock = `Aftertrace-${macKind(arch)}.zip.blockmap`
        copyFile(path.join(outDir, zipBlock), path.join(outDir, stableBlock))
        copyFile(path.join(outDir, stableBlock), path.join(outDir, `Aftertrace-${version}-${macKind(arch)}.zip.blockmap`))
        made.push(stableBlock)
      }
    }
  }

  const arm = byArch.arm64
  if (arm && arm.dmg) {
    copyFile(path.join(outDir, arm.dmg.stable), path.join(outDir, "Aftertrace-mac.dmg"))
    copyFile(path.join(outDir, "Aftertrace-mac.dmg"), path.join(outDir, versionedName(version, "mac", "dmg")))
    made.push("Aftertrace-mac.dmg", versionedName(version, "mac", "dmg"))
  }
  if (arm && arm.zip) {
    copyFile(path.join(outDir, arm.zip.stable), path.join(outDir, "Aftertrace-mac.zip"))
    copyFile(path.join(outDir, "Aftertrace-mac.zip"), path.join(outDir, versionedName(version, "mac", "zip")))
    made.push("Aftertrace-mac.zip", versionedName(version, "mac", "zip"))
    const armBlock = path.join(outDir, "Aftertrace-mac-arm64.zip.blockmap")
    if (fs.existsSync(armBlock)) {
      copyFile(armBlock, path.join(outDir, "Aftertrace-mac.zip.blockmap"))
      copyFile(path.join(outDir, "Aftertrace-mac.zip.blockmap"), path.join(outDir, `Aftertrace-${version}-mac.zip.blockmap`))
    }
  }

  if (MAC_ARCHES.every((arch) => byArch[arch] && byArch[arch].zip)) {
    writeMacLatestYml(outDir, version)
  } else if (arm && arm.zip) {
    missing.push("latest-mac.yml (need both Aftertrace-mac-arm64.zip and Aftertrace-mac-x64.zip)")
  }
}

function run(outDir, version) {
  const files = listFiles(outDir)
  const made = []
  const missing = []

  const hasMac = files.some((f) => f.endsWith(".dmg") || /Aftertrace-.*mac/i.test(f))
  if (hasMac) {
    stabilizeMac(outDir, files, version, made, missing)
  }

  const winExe = ensureStable(outDir, files, {
    kind: "win",
    ext: "exe",
    match: (f) => f.endsWith(".exe") && !f.toLowerCase().includes("uninstaller"),
  })
  const linuxApp = ensureStable(outDir, files, {
    kind: "linux",
    ext: "AppImage",
    match: (f) => f.endsWith(".AppImage"),
  })
  const linuxDeb = ensureStable(outDir, files, {
    kind: "linux",
    ext: "deb",
    match: (f) => f.endsWith(".deb"),
  })

  const copyVersioned = (info, kind, ext) => {
    if (!info) return
    const vname = versionedName(version, kind, ext)
    copyFile(path.join(outDir, info.stable), path.join(outDir, vname))
    made.push(info.stable, vname)
  }

  if (winExe) {
    copyVersioned(winExe, "win", "exe")
    const block = pick(files, (f) => f.endsWith(".exe.blockmap") || f === `${winExe.original}.blockmap`)
    if (block) {
      copyFile(path.join(outDir, block), path.join(outDir, "Aftertrace-win.exe.blockmap"))
      copyFile(path.join(outDir, "Aftertrace-win.exe.blockmap"), path.join(outDir, `Aftertrace-${version}-win.exe.blockmap`))
    }
    const ymlPath = path.join(outDir, "latest.yml")
    if (fs.existsSync(ymlPath)) {
      let text = fs.readFileSync(ymlPath, "utf8")
      text = rewriteAll(text, winExe.original, winExe.stable)
      fs.writeFileSync(ymlPath, text)
    } else {
      writeLatestYml(outDir, "latest.yml", version, winExe.stable)
    }
  }

  if (linuxApp || linuxDeb) {
    if (!linuxApp) missing.push("Aftertrace-linux.AppImage")
    if (!linuxDeb) missing.push("Aftertrace-linux.deb")
    copyVersioned(linuxApp, "linux", "AppImage")
    copyVersioned(linuxDeb, "linux", "deb")
    const ymlPath = path.join(outDir, "latest-linux.yml")
    if (fs.existsSync(ymlPath) && linuxApp) {
      let text = fs.readFileSync(ymlPath, "utf8")
      text = rewriteAll(text, linuxApp.original, linuxApp.stable)
      fs.writeFileSync(ymlPath, text)
    } else if (linuxApp) {
      writeLatestYml(outDir, "latest-linux.yml", version, linuxApp.stable)
    }
  }

  if (missing.length) {
    throw new Error(`stable artifacts missing: ${missing.join(", ")} (in ${outDir}: ${listFiles(outDir).join(", ")})`)
  }

  const produced = listFiles(outDir)
  const wantAny = produced.some((f) => f.startsWith("Aftertrace-"))
  if (!wantAny) {
    throw new Error(`no Aftertrace-* artifacts in ${outDir}: ${produced.join(", ")}`)
  }
  return { made: [...new Set(made)], files: produced }
}

if (require.main === module) {
  const pkg = require("../package.json")
  const outDir = process.argv[2] || path.join(__dirname, "..", "dist")
  const version = process.argv[3] || pkg.version
  const result = run(outDir, version)
  process.stdout.write(`stable artifacts in ${outDir}:\n${result.files.filter((f) => /Aftertrace|latest/i.test(f)).join("\n")}\n`)
}

module.exports = { run, writeLatestYml, writeMacLatestYml, versionedName, MAC_ARCHES }
