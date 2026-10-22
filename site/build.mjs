// Builds the website into site/dist: the landing page, every doc rendered
// to HTML with a shared sidebar, the mock UI as a live demo under /demo/,
// and install.sh. Run from the repo root or from site/: node site/build.mjs
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { marked } from "marked"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "..")
const out = join(here, "dist")
const repo = "https://github.com/RahulKraken/aftertrace"

const NAV = [
  ["Get started", [["how-it-works", "How it works"], ["install", "Install"], ["claude-code-setup", "Connect Claude Code"], ["apps", "Apps and agents"], ["behind-a-collector", "Behind a collector"]]],
  ["Use", [["findings", "Findings"], ["cli", "CLI"], ["privacy", "Privacy"], ["troubleshooting", "Troubleshooting"]]],
  ["Extend", [["writing-rules", "Writing rules"], ["api", "JSON API"], ["schema-notes", "Schema notes"]]],
  ["Project", [["product/brief", "Product brief"], ["product/design", "Design"], ["design-principles", "Design principles"], ["spec", "Spec"], ["stack", "Stack decision"]]],
]

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(join(here, "public"), out, { recursive: true })
cpSync(join(root, "install.sh"), join(out, "install.sh"))
cpSync(join(root, "web/public/favicon.svg"), join(out, "favicon.svg"))
mkdirSync(join(out, "assets/fonts"), { recursive: true })
for (const f of readdirSync(join(root, "web/src/fonts"))) if (f.endsWith(".woff2")) cpSync(join(root, "web/src/fonts", f), join(out, "assets/fonts", f))
mkdirSync(join(out, "assets/shots"), { recursive: true })
for (const f of readdirSync(join(root, "web/screenshots"))) if (f.endsWith(".png")) cpSync(join(root, "web/screenshots", f), join(out, "assets/shots", f))

// Figures: interactive drawings from docs/figures, one light and one dark
// page each. A doc places one with <!-- figure:name --> followed by its
// still image, which is what GitHub shows; the site swaps both for the live
// figure in the reader's theme.
for (const f of readdirSync(join(root, "docs/figures"))) {
  const build = join(root, "docs/figures", f, "build.mjs")
  if (!existsSync(build)) continue
  for (const args of [[], ["--dark"]]) execFileSync("node", [build, ...args], { stdio: "inherit", env: { ...process.env, FIGURES_OUT: join(out, "figures") } })
}
function figures(md, depth) {
  const up = "../".repeat(depth)
  return md.replace(/<!-- figure:(\w+) -->\n!\[([^\]]*)\]\([^)]*\)/g, (_, name, alt) =>
    `<div class="figure-embed" data-figure="${name}">` +
    `<iframe class="fig-light" src="${up}figures/${name}.html" title="${alt.replace(/"/g, "&quot;")}" loading="lazy"></iframe>` +
    `<iframe class="fig-dark" src="${up}figures/${name}-dark.html" title="${alt.replace(/"/g, "&quot;")}" loading="lazy"></iframe>` +
    `</div>`)
}
const FIGURE_SCRIPT = `<script>addEventListener("message",(e)=>{const d=e.data;if(!d||!d.figure||!d.height)return;for(const f of document.querySelectorAll(".figure-embed iframe"))if(f.contentWindow===e.source)f.style.height=d.height+"px"})</script>`

// Docs: markdown to HTML, .md links to .html, repo links to GitHub.
function rewriteLinks(html, depth) {
  const up = "../".repeat(depth)
  return html.replace(/href="([^"#:]+?)\.md(#[^"]*)?"/g, (_, p, h = "") => {
    const clean = p.replace(/^\.\//, "")
    if (clean.startsWith("../")) {
      const target = clean.replace(/^(\.\.\/)+/, "")
      if (target === "README" || target === "CONTRIBUTING" || target === "CHANGELOG") return `href="${repo}/blob/main/${target}.md${h}"`
      return `href="${up}docs/${target}.html${h}"`
    }
    return `href="${clean}.html${h}"`
  }).replace(/href="(\.\.\/)+((?:internal|web|cmd|rules|\.github)[^"]*)"/g, (_, _u, p) => `href="${repo}/tree/main/${p}"`)
    .replace(/href="\.\.\/(LICENSE|install\.sh|go\.mod)"/g, (_, p) => `href="${repo}/blob/main/${p}"`)
}

function nav(current, depth) {
  const up = "../".repeat(depth)
  return NAV.map(
    ([group, items]) =>
      `<div class="dn-group"><div class="dn-label">${group}</div>${items
        .map(([slug, label]) => `<a href="${up}docs/${slug}.html"${slug === current ? ' class="on" aria-current="page"' : ""}>${label}</a>`)
        .join("")}</div>`,
  ).join("")
}

function page({ title, body, current, depth }) {
  const up = "../".repeat(depth)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · Aftertrace docs</title>
<link rel="icon" type="image/svg+xml" href="${up}favicon.svg" />
<link rel="stylesheet" href="${up}styles.css" />
</head>
<body class="docs-body">
<header class="top"><a class="brand" href="${up}index.html">${LOGO}<span>aftertrace</span></a><nav class="top-links"><a href="${up}docs/install.html" class="on">Docs</a><a href="${up}demo/">Live demo</a><a href="${repo}">GitHub</a></nav></header>
<div class="docs">
<aside class="docs-nav">${nav(current, depth)}</aside>
<main class="prose">${body}
<p class="edit"><a href="${repo}/edit/main/docs/${current}.md">Edit this page on GitHub</a></p>
</main>
</div>
</body>
</html>`
}

const LOGO = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2" y="4" width="13" height="4" rx="2" fill="currentColor"/><rect x="7" y="10" width="15" height="4" rx="2" fill="currentColor" opacity="0.55"/><rect x="12" y="16" width="8" height="4" rx="2" fill="#e29a2e"/></svg>`

marked.setOptions({ gfm: true })
for (const [, items] of NAV) {
  for (const [slug] of items) {
    const src = join(root, "docs", `${slug}.md`)
    if (!existsSync(src)) throw new Error(`missing doc ${src}`)
    const md = readFileSync(src, "utf8")
    const title = (md.match(/^#\s+(.+)$/m) || [, slug])[1]
    const depth = slug.split("/").length
    const body = rewriteLinks(marked.parse(figures(md, depth)), depth) + (md.includes("<!-- figure:") ? FIGURE_SCRIPT : "")
    const dest = join(out, "docs", `${slug}.html`)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, page({ title, body, current: slug, depth }))
  }
}
cpSync(join(root, "docs/images"), join(out, "docs/images"), { recursive: true })
writeFileSync(join(out, "docs/index.html"), `<!doctype html><meta http-equiv="refresh" content="0; url=install.html"><a href="install.html">Docs</a>`)

// The demo: the mock UI (synthetic fixtures, no server) with relative paths.
if (!process.env.SKIP_DEMO) {
  execFileSync("npx", ["vite", "build", "--base", "./", "--outDir", join(out, "demo"), "--emptyOutDir"], {
    cwd: join(root, "web"),
    stdio: "inherit",
    env: { ...process.env, VITE_USE_MOCK: "1", VITE_DEMO: "1" },
  })
}
console.log(`site built in ${out}`)
