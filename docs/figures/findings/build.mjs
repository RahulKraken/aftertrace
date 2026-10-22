// Fig 5 · Findings, as a card-reading machine.
// A rack holds one stencil card per rule, in the order the engine runs them.
// The card being read lifts; a gantry sweeps a beam across the store bed (the
// four tables) in that rule's pillar colour, and the rows the rule matches
// light up. Each row the query returns is a finding: the printer feeds out a
// ticket, which drops into the tray for its severity, and a thread runs from
// the ticket back to its evidence. A rule that matches nothing prints nothing.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as k from "../kit/iso-kit.mjs"
import { glCamera } from "../kit/gl.mjs"
import { kitScript, glScript } from "../kit/inline.mjs"
import { MODEL } from "../model.mjs"
import { RULES, SEVERITIES } from "./rules.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = process.env.FIGURES_OUT || join(HERE, "..", "dist")
const theme = process.argv.includes("--dark") ? "dark" : "light"

const W = 760
const H = 350

// ── World plan (units ≈ px; x along the bench, y toward the reader, z up) ──
const BENCH = { x: -250, y: -64, w: 462, d: 128, r: 10 }
const BENCH_H = 12
const FOOT_H = 6

// The card rack, left. Cards stand on edge across the rack, one per rule.
const RACK = { x: -236, y: -30, w: 78, d: 56, r: 3 }
const RACK_H = 8
const CARD = { w: 1.4, d: 40, h: 32 } // a card: thin in x
const CARD_Y = RACK.y + (RACK.d - CARD.d) / 2
const CARD_GAP = 4.4
const CARD_X0 = RACK.x + 10
const cardX = (i) => CARD_X0 + i * CARD_GAP
const LIFT = 12
// Index tabs: where a card's tab sits says its pillar, as in a card file.
const TAB_Y = { bottleneck: CARD_Y + 4, cost: CARD_Y + 16, config: CARD_Y + 28 }

// The store bed: four recessed panels, one per table.
const BED = { x: -142, y: -50, w: 166, d: 100, r: 4 }
const BED_H = 10
const RAIL = { far: BED.y + 2, near: BED.y + BED.d - 6 } // y of each rail, 4 deep
const PANEL_X = [BED.x + 10, BED.x + BED.w - 10]
const PANELS = MODEL.tables.map((t, i) => ({ table: t, x: PANEL_X[0], y: BED.y + 10 + i * 21, w: PANEL_X[1] - PANEL_X[0], d: 18, r: 1.5 }))
const SWEEP = [BED.x + 14, BED.x + BED.w - 14] // gantry travel
const GANTRY_TOP = 48
const LENS_Z = GANTRY_TOP - 6 // bottom of the lens housing: where the beam starts

// The printer, and the sorting tray it feeds.
const PRN = { x: 46, y: -32, w: 54, d: 60, r: 4 }
const PRN_H = 40
const SLOT_Z = 18
const DIAL = { x: PRN.x + 16, y: PRN.y + 18, r: 9 }
const TRAY = { x: 112, y: -26, w: 84, d: 48, r: 2 }
const BIN_W = 19.5
const binX = (i) => TRAY.x + 2 + i * (BIN_W + 1) // left edge of compartment i
const WALL_H = 7
const TICKET = { w: 14, d: 34 }
const STACK_MAX = 6

const P = k.fitProjection(
  [...k.boxCorners(BENCH, -BENCH_H - FOOT_H, 0), [BED.x, BED.y, GANTRY_TOP + 8], [BED.x + BED.w, BED.y + BED.d, GANTRY_TOP + 8], [RACK.x, RACK.y, RACK_H + CARD.h + LIFT + 4]],
  W,
  H,
  { pad: 14, azimuth: 56 },
)

const at = (p) => k.iso(p, P)
const S = (paths, style) => k.solidSvg(paths, style)
const L = (d, style) => k.lineSvg(d, style)
const D = (pts, style) => k.dotsSvg(pts, style)
const byDepth = (pts) => [...pts].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P))
const g = (part, body, extra = "") => `<g data-part="${part}"${extra}>${body}</g>`
const xy = (p) => `cx="${at(p)[0].toFixed(1)}" cy="${at(p)[1].toFixed(1)}"`
const box = (x0, y0, z0, x1, y1, z1) => [x0, y0, z0, x1, y1, z1]

// ── Base ───────────────────────────────────────────────────────────────────
function bench() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BENCH, -BENCH_H - FOOT_H, BENCH_H, P)}"/>`]
  for (const [x, y] of byDepth(k.corners(BENCH, 26))) {
    out.push(S(k.cylinder(x, y, 8, -BENCH_H - FOOT_H, 1.8, P, 28), { tone: "lo" }))
    out.push(S(k.cylinder(x, y, 6, -BENCH_H - FOOT_H + 1.8, FOOT_H - 1.8, P, 28), { tone: "mid" }))
  }
  out.push(S(k.slabOf(BENCH, -BENCH_H, BENCH_H, P, 8, 1.6), { tone: "mid" }))
  out.push(L(k.planOutline(k.insetPlan(BENCH, 6), 0, P), { tone: "lo" }))
  const screws = k.corners(BENCH, 12)
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.4, 0, P, 16)).join(""), { tone: "lo" }))
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }))
  // A ruler along the front edge.
  const strip = { x: BENCH.x + 40, y: BENCH.y + BENCH.d - 15, w: BENCH.w - 80, d: 7, r: 1 }
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }))
  const t = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 5, 5, strip.y + 0.8, 0.6, [2, 3.8], P)
  out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }))
  out.push(D([at([strip.x + 2, strip.y + 3.5, 0.6]), at([strip.x + strip.w - 2, strip.y + 3.5, 0.6])], { size: 0.45 }))
  return out.join("")
}

// ── 1. The rack of rule cards ──────────────────────────────────────────────
function rack() {
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(RACK, 2), 0, 0.1, P)}" style="filter:blur(4px)"/>`]
  out.push(S(k.slabOf(RACK, 0, RACK_H, P, 3, 0.6), { tone: "mid" }))
  // Two runners the cards stand in, each a slotted comb.
  for (const y of [CARD_Y + 3, CARD_Y + CARD.d - 7]) {
    out.push(S(k.slabOf({ x: RACK.x + 6, y, w: RACK.w - 12, d: 4, r: 0.8 }, RACK_H, 2, P, 2, 0.3), { tone: "lo" }))
  }
  for (const [x, y] of k.corners(RACK, 3.5)) out.push(D([at([x, y, RACK_H])], { size: 0.45 }))
  return out.join("")
}
// The end plate at the back of the rack, standing behind the first card.
function rackBackPlate() {
  const plate = { x: RACK.x + 3, y: CARD_Y - 3, w: 4, d: CARD.d + 6, r: 1.5 }
  return S(k.slabOf(plate, RACK_H, CARD.h - 10, P, 3, 0.4), { tone: "mid" })
}
// The follower: a block on the runners that keeps the cards upright, at the front.
function follower() {
  const x = cardX(RULES.length - 1) + CARD.w + 1.2
  const plate = { x, y: CARD_Y - 1, w: 5, d: CARD.d + 2, r: 1.2 }
  const out = [S(k.slabOf(plate, RACK_H, 22, P, 3, 0.5), { tone: "mid" })]
  // Its knurled thumb screw on top.
  out.push(S(k.cylinder(x + 2.5, CARD_Y + CARD.d / 2, 2.6, RACK_H + 22, 3, P, 20), { tone: "hi", crease: "lo" }))
  out.push(L(k.knurl(x + 2.5, CARD_Y + CARD.d / 2, 2.6, RACK_H + 22, RACK_H + 25, 16, P), { tone: "lo" }))
  // A label plate on its face: the one engraved label in the figure.
  const lp = { x: x + 5, y: CARD_Y + 6 }
  out.push(k.faceTextSvg(k.sideMatrix([lp.x, lp.y], RACK_H + 9, P, "right"), "RULES", { size: 3, tone: "lo", anchor: "end" }))
  return out.join("")
}
// The holes punched in a card: a pattern of its own per rule, from its id.
function holes(id) {
  let h = 2166136261
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0
  const out = []
  for (let r = 0; r < 3; r++) for (let c = 0; c < 7; c++) if ((h >>> ((r * 7 + c) % 31)) & 1) out.push([c, r])
  return out
}
function card(r, i) {
  const x = cardX(i)
  const plan = { x, y: CARD_Y, w: CARD.w, d: CARD.d, r: 0.3 }
  const out = [S(k.slabOf(plan, RACK_H + 1, CARD.h, P, 2), { tone: "mid", crease: "faint" })]
  // Stencil holes in the upper band of the near face, seen when the card is lifted.
  const m = k.sideMatrix([x + CARD.w, CARD_Y + CARD.d], RACK_H + 1 + CARD.h, P, "right")
  const pts = holes(r.id).map(([c, rr]) => `<circle cx="${(4 + c * 4.6).toFixed(1)}" cy="${(3.4 + rr * 3.6).toFixed(1)}" r="0.95"/>`)
  out.push(`<g class="fig-holes" transform="${m}">${pts.join("")}</g>`)
  // Its index tab, in its pillar's colour.
  const ty = TAB_Y[r.pillar] ?? TAB_Y.cost
  out.push(`<g class="fig-tab" data-pillar="${r.pillar}">${S(k.slabOf({ x: x - 0.1, y: ty, w: CARD.w + 0.2, d: 8, r: 0.3 }, RACK_H + 1 + CARD.h, 3, P, 2), { tone: "hi", crease: "none" })}</g>`)
  // The red flag a broken rule shows.
  out.push(`<g class="fig-broken">${S(k.slabOf({ x: x - 0.1, y: CARD_Y + CARD.d - 6, w: CARD.w + 0.2, d: 4, r: 0.3 }, RACK_H + 1 + CARD.h, 2, P, 2), { tone: "hi", crease: "none" })}</g>`)
  return `<g data-card="${i}" data-pillar="${r.pillar}">${out.join("")}</g>`
}

// Ribbon from the rack to the reader, and from the reader to the printer.
function ribbons() {
  const out = []
  const a = [RACK.x + RACK.w, 0, 4]
  const b = [BED.x, 0, 5]
  out.push(k.wireSvg(at(a), at(b), { via: [at([a[0] + 6, 0, 4]), at([b[0] - 6, 0, 5])], tone: "mid", ends: "both", size: 1.1 }))
  return out.join("")
}
function ribbonOut() {
  const a = [BED.x + BED.w, 30, 5]
  const b = [PRN.x, 20, 8]
  return k.wireSvg(at(a), at(b), { via: [at([a[0] + 8, 30, 5]), at([b[0] - 8, 20, 8])], tone: "mid", ends: "both", size: 1.1 })
}

// ── 2. The store bed: one recessed panel per table, its rows as dots ───────
function bed() {
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(BED, 2), 0, 0.1, P)}" style="filter:blur(5px)"/>`]
  out.push(S(k.slabOf(BED, 0, 4, P, 4, 0.6), { tone: "lo" }))
  out.push(S(k.slabOf(k.insetPlan(BED, 2), 4, BED_H - 4, P, 4, 0.8), { tone: "mid" }))
  for (const p of PANELS) {
    out.push(`<g data-panel="${p.table}">`)
    out.push(S(k.slabOf(p, BED_H - 0.2, 0.2, P, 2), { tone: "lo", flat: true, crease: "none" }))
    out.push(L(k.planOutline(p, BED_H, P, 2), { tone: "lo" }))
    out.push(D(k.dotGrid(p.x + 4, p.y + 4, 29, 3, 5, BED_H, P), { size: 0.38, tone: "lo" }))
    out.push("</g>")
  }
  // Feet of the rails, screwed down at each end.
  for (const y of [RAIL.far + 2, RAIL.near + 2]) out.push(D([at([BED.x + 4, y, BED_H]), at([BED.x + BED.w - 4, y, BED_H])], { size: 0.45 }))
  return out.join("")
}
function rail(y) {
  const out = [S(k.slabOf({ x: BED.x + 6, y, w: BED.w - 12, d: 4, r: 1 }, BED_H, 3, P, 2, 0.3), { tone: "mid" })]
  // End stops.
  for (const x of [BED.x + 6, BED.x + BED.w - 10]) out.push(S(k.slabOf({ x, y: y - 0.5, w: 4, d: 5, r: 0.8 }, BED_H + 3, 3, P, 2), { tone: "lo" }))
  return out.join("")
}

// ── 3. The gantry: two uprights on the rails and the lens bar across ───────
// Built at x = 0 and moved along x with translateAlong.
function upright(y) {
  const out = []
  out.push(S(k.slabOf({ x: -6, y: y - 1, w: 12, d: 6, r: 1.2 }, BED_H + 3, 4, P, 3, 0.4), { tone: "mid" })) // bushing block
  out.push(S(k.slabOf({ x: -3, y, w: 6, d: 4, r: 1 }, BED_H + 7, GANTRY_TOP - BED_H - 7, P, 3, 0.4), { tone: "mid" }))
  out.push(D([at([-4.5, y + 4.6, BED_H + 5]), at([4.5, y + 4.6, BED_H + 5])], { size: 0.4 }))
  return out.join("")
}
function gantryBack() {
  return upright(RAIL.far)
}
function gantryFront() {
  const out = []
  const bar = { x: -5, y: RAIL.far - 1, w: 10, d: RAIL.near - RAIL.far + 6, r: 1.5 }
  out.push(S(k.slabOf({ x: -2.5, y: PANELS[0].y - 1, w: 5, d: PANELS[3].y + PANELS[3].d - PANELS[0].y + 2, r: 1 }, LENS_Z, GANTRY_TOP - LENS_Z, P, 2, 0.3), { tone: "hi", crease: "lo" }))
  out.push(upright(RAIL.near))
  out.push(S(k.slabOf(bar, GANTRY_TOP, 5, P, 3, 0.6), { tone: "mid" }))
  out.push(L(k.planOutline(k.insetPlan(bar, 2), GANTRY_TOP + 5, P, 2), { tone: "faint" }))
  out.push(D([at([0, RAIL.far + 1.5, GANTRY_TOP + 5]), at([0, RAIL.near + 2.5, GANTRY_TOP + 5])], { size: 0.45 }))
  // The read lamp on top of the bar: lit while a card is being read.
  out.push(`<circle class="fig-lamp" data-part="read-lamp" ${xy([0, 0, GANTRY_TOP + 5])} r="1.5"/>`)
  return out.join("")
}

// ── 4. The printer ─────────────────────────────────────────────────────────
function printer() {
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(PRN, 2), 0, 0.1, P)}" style="filter:blur(4px)"/>`]
  out.push(S(k.slabOf(PRN, 0, 6, P, 4, 0.6), { tone: "lo" }))
  const body = k.insetPlan(PRN, 2)
  out.push(S(k.slabOf(body, 6, PRN_H - 6, P, 4, 0.8), { tone: "hi", crease: "lo", inner: L(k.sideSeam(body, PRN_H - 12, P, 4), { tone: "faint" }) }))
  // The lid over the paper roll, with its hinge line and a finger notch.
  const lid = { x: body.x + 26, y: body.y + 4, w: body.w - 30, d: body.d - 8, r: 3 }
  out.push(S(k.slabOf(lid, PRN_H, 2, P, 4, 0.5), { tone: "mid" }))
  out.push(L(k.lineOnTop([lid.x + 5, lid.y], [lid.x + 5, lid.y + lid.d], PRN_H + 2, P), { tone: "lo" }))
  out.push(L(k.ring(lid.x + lid.w - 5, lid.y + lid.d / 2, 1.6, PRN_H + 2, P, 14), { tone: "lo" }))
  for (const [x, y] of k.corners(body, 3.5)) out.push(D([at([x, y, PRN_H])], { size: 0.45 }))
  // Vents on the near face.
  const vm = k.sideMatrix([0, body.y + body.d], 0, P, "left")
  const vents = [0, 1, 2, 3, 4].map((i) => `<rect x="${body.x + 7.4 + i * 4}" y="${-PRN_H + 12}" width="1.3" height="10" rx="0.65"/>`).join("")
  out.push(`<g class="fig-vents" transform="${vm}">${vents}</g>`)
  // The ticket slot on the side facing the tray, and the lip under it.
  const sm = k.sideMatrix([body.x + body.w, 0], 0, P, "right")
  out.push(`<g transform="${sm}"><rect class="fig-slot" x="${-TICKET.d / 2 - 2}" y="${-SLOT_Z - 1.6}" width="${TICKET.d + 4}" height="3.2" rx="1.2"/></g>`)
  out.push(S(k.slabOf({ x: body.x + body.w, y: -TICKET.d / 2 - 3, w: 3, d: TICKET.d + 6, r: 0.6 }, SLOT_Z - 4, 1.6, P, 2), { tone: "mid" }))
  // The feed lamp: lit while a ticket prints.
  out.push(`<circle class="fig-lamp" data-part="feed-lamp" data-hue="wait" ${xy([body.x + 6, body.y + body.d - 6, PRN_H])} r="1.5"/>`)
  return out.join("")
}
// The cache dial on the printer's top: one turn of the needle is ten seconds.
function dial() {
  const out = []
  out.push(S(k.cylinder(DIAL.x, DIAL.y, DIAL.r, PRN_H, 2, P, 36, 0.4), { tone: "mid" }))
  out.push(L(k.knurl(DIAL.x, DIAL.y, DIAL.r, PRN_H, PRN_H + 2, 34, P), { tone: "lo" }))
  const face = DIAL.r - 1.6
  out.push(S(k.cylinder(DIAL.x, DIAL.y, face, PRN_H + 2, 0.3, P, 36), { tone: "hi", crease: "none", flat: true }))
  const t = k.radialTicks(DIAL.x, DIAL.y, face - 0.6, 10, 5, PRN_H + 2.3, [1.2, 2.2], P)
  out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }))
  // The needle, drawn in the plane of the face and turned by the page.
  const m = k.topMatrix([DIAL.x, DIAL.y], PRN_H + 2.4, P)
  out.push(`<g transform="${m}"><g data-part="needle"><line class="fig-needle" x1="0" y1="0" x2="${(face - 2).toFixed(1)}" y2="0"/></g><circle class="fig-hub" cx="0" cy="0" r="1.1"/></g>`)
  return out.join("")
}

// ── 5. The sorting tray: high, medium, low, error ──────────────────────────
function trayBase() {
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(TRAY, 1), 0, 0.1, P)}" style="filter:blur(3px)"/>`]
  out.push(S(k.slabOf(TRAY, 0, 3, P, 3, 0.4), { tone: "mid" }))
  // Back wall along the whole tray.
  out.push(S(k.slabOf({ x: TRAY.x, y: TRAY.y, w: TRAY.w, d: 2, r: 0.5 }, 3, WALL_H, P, 2), { tone: "mid" }))
  return out.join("")
}
// One compartment's own walls: the divider on its left (the back side) and its floor marks.
function binBack(i) {
  const x = binX(i)
  const out = [S(k.slabOf({ x: x - 1, y: TRAY.y + 2, w: 1, d: TRAY.d - 4, r: 0.3 }, 3, WALL_H, P, 2), { tone: "mid" })]
  // Severity notches on the floor: three for high, two, one, and a cross for error.
  const n = 3 - i
  for (let j = 0; j < Math.max(n, 0); j++) out.push(L(k.lineOnTop([x + 3 + j * 2.4, TRAY.y + TRAY.d - 7], [x + 3 + j * 2.4, TRAY.y + TRAY.d - 4], 3, P), { tone: "lo" }))
  if (i === 3) out.push(`<circle class="fig-lamp" data-part="error-lamp" data-hue="error" ${xy([x + BIN_W / 2, TRAY.y + TRAY.d - 5, 3])} r="1.3"/>`)
  return out.join("")
}
function stack(i) {
  const x = binX(i) + (BIN_W - TICKET.w) / 2
  const out = []
  for (let n = 0; n < STACK_MAX; n++) {
    const plan = { x: x + (n % 2) * 0.5, y: -TICKET.d / 2 - 1 + (n % 3) * 0.4, w: TICKET.w, d: TICKET.d, r: 0.6 }
    out.push(`<g class="ticket" data-n="${n}">${S(k.slabOf(plan, 3 + n * 1.2, 0.9, P, 2), { tone: "hi", crease: "none" })}${printed(plan, 3 + n * 1.2 + 0.9)}</g>`)
  }
  return `<g data-stack="${i}">${out.join("")}</g>`
}
// What a ticket has printed on it: a severity bar, a headline, two lines of detail.
// Printed as thin flat inlays, the way ink sits on paper, so no mark floats.
function printed(plan, z) {
  const x0 = plan.x + 2.5
  const span = plan.w - 8
  const marks = [
    { x: x0, y: plan.y + 4, w: 1.2, d: 8, tone: "mid" },
    { x: x0 + 3, y: plan.y + 4, w: span * 0.9, d: 0.9, tone: "lo" },
    { x: x0 + 3, y: plan.y + 16, w: span * 0.7, d: 0.7, tone: "faint" },
    { x: x0 + 3, y: plan.y + 19.5, w: span * 0.55, d: 0.7, tone: "faint" },
  ]
  return marks.map((m) => S(k.slabOf({ x: m.x, y: m.y, w: m.w, d: m.d, r: 0.2 }, z, 0.05, P, 1), { tone: m.tone, flat: true, crease: "none" })).join("")
}
// The near wall and the right end of the tray, in front of the tickets.
function trayFront() {
  const out = []
  out.push(S(k.slabOf({ x: TRAY.x + TRAY.w - 2, y: TRAY.y + 2, w: 2, d: TRAY.d - 4, r: 0.5 }, 3, WALL_H, P, 2), { tone: "mid" }))
  out.push(S(k.slabOf({ x: TRAY.x, y: TRAY.y + TRAY.d - 2, w: TRAY.w, d: 2, r: 0.5 }, 3, WALL_H * 0.5, P, 2), { tone: "mid" }))
  out.push(D([at([TRAY.x + 2, TRAY.y + TRAY.d - 1, 3 + WALL_H * 0.5]), at([TRAY.x + TRAY.w - 2, TRAY.y + TRAY.d - 1, 3 + WALL_H * 0.5])], { size: 0.4 }))
  return out.join("")
}
// The ticket in flight from the slot to its compartment, built at the origin.
function flying() {
  const plan = { x: -TICKET.w / 2, y: -TICKET.d / 2, w: TICKET.w, d: TICKET.d, r: 0.6 }
  return `<g data-part="flying" class="fig-flying">${S(k.slabOf(plan, 0, 0.9, P, 2), { tone: "hi", crease: "none" })}${printed(plan, 0.9)}<circle class="fig-chip" ${xy([TICKET.w / 2 - 3, 0, 0.9])} r="1.2"/></g>`
}

// ── Assemble: back SVG, the light canvas, front SVG ────────────────────────
const st = (station, body) => `<g data-station="${station}">${body}</g>`
const back = [
  bench(),
  st("rack", rack() + rackBackPlate() + RULES.map(card).join("") + follower()),
  st("store", ribbons() + bed() + rail(RAIL.far)),
  st("engine", `<g data-part="gantry-back" transform="${k.translateAlong(P, [SWEEP[1], 0, 0])}">${gantryBack()}</g>`),
]
const front = [
  st("store", rail(RAIL.near)),
  st("engine", `<g id="gantry-front" data-part="gantry-front" transform="${k.translateAlong(P, [SWEEP[1], 0, 0])}">${gantryFront()}</g>`),
  st("printer", ribbonOut() + printer()),
  st("cache", dial()),
  st("tray", trayBase() + SEVERITIES.map((_, i) => binBack(i) + stack(i)).join("") + trayFront()),
  flying(),
  // The thread from the newest ticket to the row it cites. Where that row lies
  // behind the gantry, the gantry's own silhouette masks the thread.
  `<defs><mask id="behind-gantry" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/><use href="#gantry-front" class="fig-silhouette"/></mask></defs>`,
  `<g class="iso-wire fig-thread" data-part="thread" data-tone="mid" opacity="0"><path class="iso-line" data-tone="mid" d="M0 0"/><circle class="iso-wire-end" data-end="a" r="1"/><circle class="iso-wire-end" data-end="b" r="1"/></g>`,
]

const LABEL = `A card-reading machine that explains how Aftertrace turns its store into findings. On the left a rack holds ${RULES.length} thin cards, one per SQL rule, each with a coloured index tab for its pillar. The card being read lifts out of the rack. A gantry on two rails sweeps a beam of light across a bed of four recessed panels, one per table in the store, and the rows the rule matches light up. A printer then feeds a ticket for each finding into a tray with four compartments, high, medium, low and error, and a thread runs from the ticket back to the row it cites. A dial on the printer turns once every ten seconds, the cache behind the sidebar count.`

const backSvg = k.figureSvg({ width: W, height: H, label: LABEL, body: back.join("") })
const frontSvg = `<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg fx-layer fx-front" viewBox="0 0 ${W} ${H}" aria-hidden="true">${front.join("")}</svg>`

// ── Hit areas and the facts the page needs ─────────────────────────────────
function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo = []
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop()
    lo.push(q)
  }
  const up = []
  for (const q of p.reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop()
    up.push(q)
  }
  return lo.slice(0, -1).concat(up.slice(0, -1)).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10])
}
const hullOf = ([x0, y0, z0, x1, y1, z1]) => hull([[x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0], [x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1]].map(at))
// The readout gives the number in short form; the unit's full wording is in the doc.
const fmt = (v, unit) => (unit.startsWith("USD") ? `$${v.toFixed(2)}` : unit.startsWith("s ") ? `${v} s` : `${v} ${unit}`)

const STATIONS = [
  { id: "rack", read: `${RULES.length} rules, one SQL file each, compiled into the binary`, box: box(RACK.x, RACK.y, 0, RACK.x + RACK.w, RACK.y + RACK.d, RACK_H + 4) },
  { id: "store", read: `the store: ${MODEL.tables.join(", ")}`, box: box(BED.x, BED.y, 0, BED.x + BED.w, BED.y + BED.d, BED_H + 3) },
  { id: "printer", read: "every row the query returns is one finding", box: box(PRN.x, PRN.y, 0, PRN.x + PRN.w, PRN.y + PRN.d, PRN_H) },
  { id: "cache", read: "the sidebar count reuses results for 10 s; the Findings page runs every rule fresh", box: box(DIAL.x - DIAL.r - 2, DIAL.y - DIAL.r - 2, PRN_H, DIAL.x + DIAL.r + 2, DIAL.y + DIAL.r + 2, PRN_H + 3) },
  ...SEVERITIES.map((s, i) => ({ id: `bin-${s}`, read: s === "error" ? "a rule that fails becomes one error finding; the others still run" : `${s}: sorted ${s === "high" ? "first" : s === "medium" ? "second" : "third"}, largest impact on top`, box: box(binX(i), TRAY.y, 0, binX(i) + BIN_W, TRAY.y + TRAY.d, WALL_H + 3) })),
  { id: "engine", read: "the engine runs each rule's SELECT against the store, in id order", box: null },
]
const CARDS = RULES.map((r, i) => ({
  id: r.id,
  title: r.title,
  pillar: r.pillar,
  detects: r.detects,
  reads: r.reads.join(", "),
  tables: r.tables.map((t) => MODEL.tables.indexOf(t)).filter((n) => n >= 0),
  ticket: r.sample ? { severity: r.sample.severity, bin: SEVERITIES.indexOf(r.sample.severity), text: `${r.sample.severity} · ${fmt(r.sample.value, r.unit)} · ${r.sample.headline}`, unit: r.unit } : null,
  hull: hullOf(box(cardX(i) - 1.6, CARD_Y, RACK_H, cardX(i) + CARD.w + 1.6, CARD_Y + CARD.d, RACK_H + CARD.h + 2)),
}))
// The beam and evidence glows know where every row dot is.
const ROWS = PANELS.map((p) => ({ x0: p.x + 4, y0: p.y + 4, cols: 29, rows: 3, gap: 5 }))

const DATA = {
  W,
  H,
  P,
  camera: glCamera(P),
  cards: CARDS,
  lift: LIFT,
  stations: STATIONS.filter((s) => s.box).map((s) => ({ id: s.id, read: s.read, hull: hullOf(s.box) })),
  engineRead: STATIONS.find((s) => s.id === "engine").read,
  sweep: SWEEP,
  gantryHull: { y0: RAIL.far - 1, y1: RAIL.near + 5, z1: GANTRY_TOP + 5 },
  bed: { x0: PANEL_X[0], x1: PANEL_X[1], y0: PANELS[0].y, y1: PANELS[3].y + PANELS[3].d, z: BED_H, lens: LENS_Z },
  rows: ROWS,
  slot: { x: PRN.x + PRN.w, z: SLOT_Z },
  bins: SEVERITIES.map((_, i) => binX(i) + BIN_W / 2),
  ticket: TICKET,
  stackMax: STACK_MAX,
  hues: { bottleneck: [0.886, 0.604, 0.18], cost: [0.388, 0.349, 0.878], config: [0.078, 0.6, 0.557] },
}
DATA.stackZ = [...Array(STACK_MAX + 1)].map((_, n) => 3 + n * 1.2 + 0.9)

const live = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA))
const CSS = readFileSync(join(HERE, "figure.css"), "utf8")
const stage = `<div class="fx-stage" tabindex="0" role="group" aria-label="Findings. Arrow keys pick a rule card; F breaks the selected rule to show what happens.">${backSvg}<canvas class="fx-layer fx-gl" aria-hidden="true"></canvas>${frontSvg}</div>`
const count = (p) => RULES.filter((r) => r.pillar === p).length
const body = k.plateHtml({
  fig: "Fig 5",
  title: "Findings",
  hint: "Point at a card · F",
  readout: `${RULES.length} rules ready`,
  keys: [
    { mark: "lit", label: "The card being read, and the lens reading the store" },
    { mark: "raised", label: `Colour is the pillar: amber bottleneck (${count("bottleneck")}), indigo cost (${count("cost")}), teal config (${count("config")}). Lit rows are rows the rule matched` },
    { mark: "edge", label: "F breaks the selected rule: it prints an error ticket and the rest still run" },
  ],
  caption: `The engine runs all ${RULES.length} rules, in id order, each as one SQL query over the store (tables ${MODEL.tables.join(", ")}, and the views built on them). Every row a query returns is one finding with a severity, an impact, a recommendation and evidence spans; a rule that matches nothing prints nothing. Findings are sorted high, medium, low, then error, and by impact within each. The tickets here are synthetic examples.`,
  body: stage,
})

mkdirSync(OUT, { recursive: true })
const file = join(OUT, theme === "dark" ? "findings-dark.html" : "findings.html")
writeFileSync(file, k.pageHtml({ title: "Findings", theme, body: `<style>${CSS}</style>${body}`, script: kitScript() + glScript() + live, width: 820 }))
console.log("wrote", file)
