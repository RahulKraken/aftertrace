const D = __DATA__;
const P = D.P;
const stage = document.querySelector(".fx-stage");
const svg = stage.querySelector("svg");
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const LIGHT = document.body.dataset.theme === "light" ? 1 : 0;
const q = (sel) => stage.querySelector(sel);

// Inside a docs page the figure drops its own page margins and tells the
// page how tall it is, so the frame fits it exactly.
if (window.parent !== window) {
  document.documentElement.dataset.embed = "";
  const post = () => window.parent.postMessage({ figure: "turn", height: Math.ceil(document.body.getBoundingClientRect().height) }, "*");
  new ResizeObserver(post).observe(document.body);
}

// ── The clock: turn milliseconds, paper travel, and the loop's phases ──
const RATE = 3.4; // turn ms per real ms: the 47.8 s turn plays in about 14 s
const SP = D.sp; // paper units per turn ms
const HOLD = 3.6, FEED = 2.2; // seconds: the finished record rests, then feeds away
const FEED_BY = 300;
const END = D.turnEnd;
let tau = 0, phase = "run", phaseClock = 0, feedShift = 0, travel = 0, paused = false, stampAt = -1;

// Who owns the moment t (Breakdown's paint order), and the interval that wins.
function ownerAt(t) {
  let best = null, bp = 99;
  for (const iv of D.ivs) {
    const p = D.priority.indexOf(iv[0]);
    if (iv[1] <= t && t < iv[2] && p < bp) { best = iv; bp = p; }
  }
  return best;
}
// Milliseconds each story segment has been painted, from the turn's start to t.
function paintedUntil(t) {
  const out = Object.fromEntries(D.segments.map((s) => [s, 0]));
  const end = Math.min(t, END);
  const cuts = [...new Set([0, end, ...D.ivs.flatMap((iv) => [iv[1], iv[2]]).filter((x) => x > 0 && x < end)])].sort((a, b) => a - b);
  for (let i = 0; i + 1 < cuts.length; i++) {
    const iv = ownerAt((cuts[i] + cuts[i + 1]) / 2);
    out[iv ? D.segOf[iv[0]] : "other"] += cuts[i + 1] - cuts[i];
  }
  return out;
}

// ── Geometry on the paper ──
const xOf = (t) => D.penX - (tau - t) * SP - feedShift;
const quad = (xa, xb, y0, y1) => {
  const z = D.paper.z;
  const pts = [[xa, y0, z], [xb, y0, z], [xb, y1, z], [xa, y1, z]].map((p) => iso(p, P));
  return "M" + pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L") + "Z";
};
const laneById = Object.fromEntries(D.lanes.map((l) => [l.id, l]));
const marks = D.marks.map((m, i) => ({ ...m, el: q(`[data-mark="${i}"]`) }));
function markPath(m) {
  const l = laneById[m.lane];
  if (m.kind === "stamp" && tau < END) return "";
  const t1 = Math.min(m.t1, tau);
  if (t1 < m.t0) return "";
  let xa = xOf(m.t0), xb = xOf(t1);
  let y0 = l.y0, y1 = l.y1;
  if (m.kind === "tick") { xa -= 0.45; xb += 0.45; y0 -= 1.3; y1 += 1.3; }
  if (m.kind === "hair") { const c = (y0 + y1) / 2; y0 = c - 0.35; y1 = c + 0.35; }
  xa = Math.max(xa, D.paper.x0); xb = Math.min(xb, D.penX);
  if (xb - xa < 0.05) return "";
  return quad(xa, xb, y0, y1);
}
const grid = q('[data-part="grid"]'), gridMajor = q('[data-part="grid-major"]');
// Lines printed on the paper every `ms` of turn time, carried with it. They run
// from the paper's back edge to the printed rule (or, for ticks, rule to front edge).
function printed(ms, y0, y1, skipEvery) {
  const step = ms * SP;
  const out = [];
  const origin = D.penX - travel; // where paper position 0 is now
  let n = Math.ceil((D.paper.x0 + 0.4 - origin) / step);
  for (let x = origin + n * step; x < D.paper.x1 - 0.4; x += step, n++) {
    if (skipEvery && n % skipEvery === 0) continue;
    const a = iso([x, y0, D.paper.z], P), b = iso([x, y1, D.paper.z], P);
    out.push(`M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`);
  }
  return out.join("");
}

// ── Pens, plungers, pilot, beads, router ──
const pens = D.lanes.map((l, i) => ({ l, el: q(`[data-part="pen-${i}"]`), plunger: q(`[data-part="plunger-${i}"]`), lift: 1 }));
const pilot = q('[data-part="pilot"]');
const carriage = q('[data-part="carriage"]');
let carriageZ = D.rodZ[3];
const beads = D.segments.map((s, r) => Array.from({ length: D.beads }, (_, i) => ({ el: q(`[data-bead="${r}-${i}"]`), x: D.beadIn, on: false })));
function penDown(lane) {
  if (phase !== "run") return false;
  if (lane === "turn") return tau < END;
  return D.marks.some((m) => m.lane === lane && (m.kind === "bar" || m.kind === "auto") && m.t0 <= tau && tau < m.t1);
}

// ── The readout ──
const secs = (ms) => (ms < 1000 ? `${Math.round(ms)}\u00a0ms` : `${(Math.round(ms / 100) / 10).toFixed(1)}\u00a0s`);
const spanById = Object.fromEntries(D.spans.map((s) => [s.id, s]));
function narrate() {
  if (phase === "feed") return "Paper feeds on · the next turn starts on fresh paper";
  if (phase === "hold" || tau >= END) {
    const p = paintedUntil(END);
    return `Turn done · ${secs(END)} · ` + D.rods.map((r) => `${secs(p[r.key])} ${r.short}`).join(" · ");
  }
  const iv = ownerAt(tau);
  if (!iv) return `Other · nothing running between spans · ${secs(tau)} into the turn`;
  const [cat, a, , id] = iv;
  const tool = (sid) => { const s = D.spans.find((x) => x.id === sid); return s ? s.read.split(" · ")[1] : ""; };
  const parentTool = D.spans.find((x) => x.lane === "tool" && x.t0 <= a && tau < x.t1);
  const name = parentTool ? tool(parentTool.id).split(" ")[0] : "";
  const el = secs(tau - a);
  if (cat === "permission_wait") return `Waiting on you · ${name} asked for permission · ${el}`;
  if (cat === "permission_check") return `Other · ${name} permission decided by config · ${el}`;
  if (cat === "retry") return `Claude thinking · the request is being retried · ${el}`;
  if (cat === "model") return `Claude thinking · model request ${D.spans.filter((s) => s.lane === "model" && s.t0 <= tau).length} · ${el}`;
  if (cat === "tool") return `Running tools · ${name} · ${el}`;
  if (cat === "hook") return `Other · a hook is running · ${el}`;
  return D.segLabel[D.segOf[cat]];
}
let focus = null; // { kind: "span" | "pen" | "rod" | "router" | "blank", id }
function write(text) { if (readout.textContent !== text) readout.textContent = text; }
function readFocus() {
  if (!focus) return narrate();
  if (focus.kind === "span") return spanById[focus.id].read;
  if (focus.kind === "pen") return D.hit.pens.find((p) => p.id === focus.id).read;
  if (focus.kind === "rod") {
    const r = D.rods.find((x) => x.key === focus.id);
    const sofar = paintedUntil(tau)[r.key];
    return phase === "run" && tau < END ? `${r.label} · ${secs(sofar)} so far · ${r.read.split(" · ").slice(2).join(" · ")}` : r.read;
  }
  if (focus.kind === "router") return `The router · each moment goes to the first of ${D.orderText} that is running, else Other`;
  if (focus.kind === "blank") return "Blank paper · the rest of the turn has not reached the pens yet";
  return "";
}

// ── Pointer and keyboard ──
const inside = (pt, poly) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
// A screen point back onto the paper's plane.
function onPaper(pt) {
  const { sinA, cosA, sinE, cosE, k } = cameraOf(P);
  const a = (pt[0] - P.origin[0]) / k;
  const c = ((pt[1] - P.origin[1]) / k + D.paper.z * cosE) / sinE;
  return [a * sinA + c * cosA, -a * cosA + c * sinA];
}
function hitAt(e) {
  const r = svg.getBoundingClientRect();
  const pt = [((e.clientX - r.left) / r.width) * D.W, ((e.clientY - r.top) / r.height) * D.H];
  if (inside(pt, D.hit.router)) return { kind: "router", id: "router" };
  for (const rd of D.hit.rods) if (inside(pt, rd.hull)) return { kind: "rod", id: rd.id };
  for (const p of D.hit.pens) if (inside(pt, p.hull)) return { kind: "pen", id: p.id };
  const [x, y] = onPaper(pt);
  if (x < D.paper.x0 || x > D.paper.x1 || y < D.paper.y0 || y > D.paper.y1) return null;
  if (x > D.penX + 2) return { kind: "blank", id: "blank" };
  const t = tau - (D.penX - feedShift - x) / SP;
  const l = D.lanes.find((ln) => y >= ln.y0 - 1.4 && y <= ln.y1 + 1.4);
  if (!l) return null;
  const s = D.spans.find((sp) => sp.lane === l.id && sp.t0 - 300 <= t && t <= Math.min(sp.t1, tau) + 300 && !(l.id === "turn" && false));
  return s ? { kind: "span", id: s.id } : null;
}
let hovering = false;
function setFocus(f) {
  focus = f;
  stage.toggleAttribute("data-focus", !!f);
  if (still.matches) render();
}
stage.addEventListener("pointermove", (e) => {
  const f = hitAt(e);
  hovering = !!f;
  setFocus(f);
});
stage.addEventListener("pointerleave", () => { hovering = false; setFocus(null); });
const order = [...D.spans].sort((a, b) => a.t0 - b.t0 || D.lanes.findIndex((l) => l.id === a.lane) - D.lanes.findIndex((l) => l.id === b.lane));
stage.addEventListener("keydown", (e) => {
  if (e.key === " ") { paused = !paused; e.preventDefault(); if (still.matches) render(); return; }
  if (e.key === "Escape") { setFocus(null); paused = false; return; }
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const i = focus && focus.kind === "span" ? order.findIndex((s) => s.id === focus.id) : -1;
  const next = order[(i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : order.length - 1)) % order.length];
  paused = true;
  // Stepping to a span the pens have not reached yet runs the recorder up to its end.
  if (phase !== "run" || next.t1 > tau) {
    if (phase !== "run") { phase = "run"; feedShift = 0; }
    if (next.t1 > tau) { travel += (next.t1 - tau) * SP; tau = next.t1; }
  }
  setFocus({ kind: "span", id: next.id });
});

// ── The light: pen tips and the fresh ink behind them, and beads in flight ──
const N = 8;
const FRAGMENT = `
uniform float uO[${N * 8}];
uniform float uLight;
uniform vec4 uPaper;
uniform float uPZ;
vec4 inkFor(vec3 seen,float cover){vec3 ab=1.-seen;float a=max(max(ab.r,max(ab.g,ab.b)),cover);return vec4(vec3(a)-ab,a);}
vec4 over(vec4 top,vec4 under){return top+under*(1.-top.a);}
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  vec3 V=towardViewer();
  vec3 r0=rayOf(vb);
  vec3 fl=onFloor(vb,uPZ);
  float px=pixelOf()/uCam.z;
  float onPaper=window(fl.x,uPaper.x,uPaper.y,.7*px)*window(fl.y,uPaper.z,uPaper.w,.7*px);
  vec3 emit=vec3(0.);
  vec4 ink=vec4(0.);
  for(int i=0;i<${N};i++){
    float a=uO[i*8+6];
    if(a<.002)continue;
    vec3 c=vec3(uO[i*8],uO[i*8+1],uO[i*8+2]);
    vec3 h=vec3(uO[i*8+3],uO[i*8+4],uO[i*8+5]);
    float pool=uO[i*8+7];
    vec3 w=c-r0;float t=dot(w,V);float d=length(c-(r0+t*V));
    float core=exp(-pow(d/1.5,2.));
    float body=exp(-pow(d/3.6,2.));
    float halo=exp(-pow(d/9.,2.))*.3;
    // Fresh ink: a strip of light along the lane, brightest at the pen, cooling as the paper carries it away.
    float dy=fl.y-c.y;
    float back=max(c.x-fl.x,0.),ahead=max(fl.x-c.x,0.);
    float trail=exp(-dy*dy/7.)*exp(-back/22.)*exp(-ahead*ahead/6.)*onPaper*pool;
    emit+=h*(body*1.05+halo+trail*.75)*a+vec3(1.)*core*.85*a;
    vec3 seenPool=mix(vec3(1.),mix(vec3(1.),h,.5),clamp(trail*a*.8,0.,1.));
    vec3 seenBody=mix(vec3(1.),h,clamp((body+halo)*a,0.,1.));
    seenBody=mix(seenBody,mix(h,vec3(1.),.7),clamp(core*a,0.,1.));
    vec4 o=over(inkFor(seenBody,core*a*.8),inkFor(seenPool,0.));
    ink=over(o,ink);
  }
  vec3 col=tonemap(emit,1.2);
  float m=max(col.r,max(col.g,col.b));
  vec4 outc=mix(vec4(col,m),ink,uLight);
  float n=(hash12(gl_FragCoord.xy+fract(uTime*.61)*91.)+hash12(gl_FragCoord.yx*1.37+fract(uTime*.37)*57.)-1.)/255.;
  outc=max(outc+n*smoothstep(0.,1.5/255.,outc.a),0.);
  outc.rgb=min(outc.rgb,vec3(outc.a));
  gl_FragColor=outc;
}`;
const layer = glLayer({
  canvas: q(".fx-gl"),
  fragment: FRAGMENT,
  view: [D.W, D.H],
  camera: D.camera,
  uniforms: ["uO"],
  fixed: { uLight: LIGHT, uPaper: [D.paper.x0, D.paper.x1, D.paper.y0, D.paper.y1], uPZ: D.paper.z },
});
if (layer) stage.setAttribute("data-gl", "");
const orbs = new Float32Array(N * 8);

// ── One frame: advance the clock, then draw everything from it ──
const focusPath = q('[data-part="focus"]');
function advance(dt) {
  if (paused || hovering) return;
  phaseClock += dt;
  if (phase === "run") {
    const dTau = dt * 1000 * RATE;
    const next = Math.min(END, tau + dTau);
    travel += (next - tau) * SP;
    tau = next;
    if (tau >= END) { phase = "hold"; phaseClock = 0; stampAt = performance.now(); }
  } else if (phase === "hold") {
    if (phaseClock > HOLD) { phase = "feed"; phaseClock = 0; }
  } else if (phase === "feed") {
    const u = Math.min(1, phaseClock / FEED);
    const ease = u * u * (3 - 2 * u);
    const want = FEED_BY * ease;
    travel += want - feedShift;
    feedShift = want;
    if (u >= 1) { phase = "run"; phaseClock = 0; tau = 0; feedShift = 0; stampAt = -1; }
  }
}
function render(dt = 1) {
  // The record.
  for (const m of marks) {
    const d = markPath(m);
    if (m.el.getAttribute("d") !== d) m.el.setAttribute("d", d || "M0 0Z");
    if (m.kind === "stamp") m.el.style.opacity = tau >= END ? String(stampAt < 0 ? 1 : Math.min(1, (performance.now() - stampAt) / 500)) : "0";
  }
  grid.setAttribute("d", printed(2000, D.paper.y0, D.rule, 5) + printed(1000, D.rule, D.paper.y1, 0));
  gridMajor.setAttribute("d", printed(10000, D.paper.y0, D.paper.y1, 0));
  // The lit outline round the span in focus.
  let fd = "";
  if (focus && focus.kind === "span") {
    const s = spanById[focus.id];
    const l = laneById[s.lane];
    const xa = Math.max(xOf(s.t0), D.paper.x0), xb = Math.min(xOf(Math.min(s.t1, tau)), D.penX);
    if (xb > xa) fd = quad(xa - 0.8, xb + 0.8, l.y0 - 1, l.y1 + 1);
  }
  focusPath.setAttribute("d", fd);
  // Pens drop onto the paper while their span runs; the solenoid's plunger moves with them.
  orbs.fill(0);
  let n = 0;
  for (const p of pens) {
    const want = penDown(p.l.id) ? 0 : 1;
    p.lift = still.matches ? want : p.lift + (want - p.lift) * (1 - Math.exp(-dt / 0.07));
    p.el.setAttribute("transform", translateAlong(P, [0, 0, p.lift * D.penLift]));
    p.plunger.setAttribute("transform", translateAlong(P, [0, 0, p.lift * 1.3]));
    const glow = 1 - p.lift;
    if (p.l.hue !== "turn" && glow > 0.01 && n < N) {
      const y = (p.l.y0 + p.l.y1) / 2;
      orbs.set([D.penX, y, D.paper.z + 0.3, ...D.hues[p.l.hue], glow, 1], n * 8);
      n++;
    }
  }
  pilot.toggleAttribute("data-on", phase === "run" && tau < END);
  // The router follows the moment's owner; each whole second painted drops a bead.
  const iv = phase === "run" && tau < END ? ownerAt(tau) : null;
  const seg = phase === "run" && tau < END ? (iv ? D.segOf[iv[0]] : "other") : null;
  if (seg) {
    const want = D.rodZ[D.segments.indexOf(seg)];
    carriageZ = still.matches ? want : carriageZ + (want - carriageZ) * (1 - Math.exp(-dt / 0.09));
    carriage.setAttribute("transform", translateAlong(P, [0, 0, carriageZ]));
  }
  const painted = phase === "feed" ? null : paintedUntil(tau);
  D.segments.forEach((s, r) => {
    const count = painted ? Math.min(D.beads, Math.floor(painted[s] / 1000)) : 0;
    beads[r].forEach((b, i) => {
      // The newest bead sits next to the router and pushes the row along.
      const on = i < count;
      const want = on ? D.beadX[count - 1 - i] : D.beadIn;
      if (on && !b.on) b.x = D.beadIn;
      b.on = on;
      const nx = still.matches ? want : b.x + (want - b.x) * (1 - Math.exp(-dt / 0.32));
      const moved = Math.abs(nx - b.x) > 0.01 || !b.el.dataset.set;
      b.x = Math.abs(nx - want) < 0.02 ? want : nx;
      const hidden = !on && b.x < D.beadIn + 0.6;
      if (moved) { b.el.setAttribute("transform", translateAlong(P, [b.x, 0, 0])); b.el.dataset.set = "1"; }
      b.el.style.visibility = hidden ? "hidden" : "";
      const flying = Math.abs(want - b.x) > 1.5 && !hidden;
      if (flying && n < N) {
        orbs.set([b.x + 1.4, D.rodY, D.rodZ[r], ...D.hues[s === "other" ? "turn" : s], 0.55, 0], n * 8);
        n++;
      }
    });
  });
  write(readFocus());
  if (layer) layer.draw({ uO: orbs }, clock);
}

let frame = 0, last = 0, clock = 0, visible = false;
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  clock += dt;
  advance(dt);
  render(dt);
  frame = visible && !still.matches ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible && !still.matches) { last = 0; frame = requestAnimationFrame(tick); } };
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
if (still.matches) {
  // A still frame that tells the whole story: the finished record and the full tally.
  tau = END;
  phase = "hold";
  travel = tau * SP;
  render();
}
