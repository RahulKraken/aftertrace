"use strict"

// After electron-builder, make sure GitHub Release / site download names exist:
//   Aftertrace-mac.dmg, Aftertrace-mac.zip, Aftertrace-win.exe,
//   Aftertrace-linux.AppImage, Aftertrace-linux.deb
// plus versioned copies (Aftertrace-0.5.0-mac.dmg) and latest-mac.yml / latest.yml
// so electron-updater can find the zip/exe on GitHub Releases.
//
// If electron-builder used a versioned or arch-suffixed name, copy to the stable
// name and rewrite the updater yml to match.

const crypto = require("crypto")
const fs = require("fs")
const path = require("path")

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

function run(outDir, version) {
  const files = listFiles(outDir)
  const made = []
  const missing = []

  const macDmg = ensureStable(outDir, files, {
    kind: "mac",
    ext: "dmg",
    match: (f) => f.endsWith(".dmg"),
  })
  const macZip = ensureStable(outDir, files, {
    kind: "mac",
    ext: "zip",
    match: (f) => f.endsWith(".zip") && !f.endsWith(".blockmap"),
  })
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

  if (macDmg || macZip) {
    if (!macDmg) missing.push("Aftertrace-mac.dmg")
    if (!macZip) missing.push("Aftertrace-mac.zip")
    copyVersioned(macDmg, "mac", "dmg")
    copyVersioned(macZip, "mac", "zip")
    const zipBlock = pick(files, (f) => f.endsWith(".zip.blockmap") || f === `${macZip && macZip.original}.blockmap`)
    if (zipBlock) {
      copyFile(path.join(outDir, zipBlock), path.join(outDir, "Aftertrace-mac.zip.blockmap"))
      copyFile(path.join(outDir, "Aftertrace-mac.zip.blockmap"), path.join(outDir, `Aftertrace-${version}-mac.zip.blockmap`))
    }
    const ymlPath = path.join(outDir, "latest-mac.yml")
    if (fs.existsSync(ymlPath) && macZip) {
      let text = fs.readFileSync(ymlPath, "utf8")
      text = rewriteAll(text, macZip.original, macZip.stable)
      if (macDmg) text = rewriteAll(text, macDmg.original, macDmg.stable)
      fs.writeFileSync(ymlPath, text)
    } else if (macZip) {
      writeLatestYml(outDir, "latest-mac.yml", version, macZip.stable)
    } else {
      missing.push("latest-mac.yml")
    }
    if (!fs.existsSync(ymlPath) && macZip) missing.push("latest-mac.yml")
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

module.exports = { run, writeLatestYml, versionedName }
