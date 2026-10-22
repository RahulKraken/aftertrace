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
  const page = document.body;
  const post = () => window.parent.postMessage({ figure: "findings", height: Math.ceil(page.getBoundingClientRect().height) }, "*");
  new ResizeObserver(post).observe(page);
}

const cards = D.cards.map((_, i) => q(`[data-card="${i}"]`));
const gBack = q('[data-part="gantry-back"]');
const gFront = q('[data-part="gantry-front"]');
const readLamp = q('[data-part="read-lamp"]');
const feedLamp = q('[data-part="feed-lamp"]');
const errLamp = q('[data-part="error-lamp"]');
const needle = q('[data-part="needle"]');
const fly = q('[data-part="flying"]');
const thread = q('[data-part="thread"]');
const threadPath = thread.querySelector("path");
const threadA = thread.querySelector('[data-end="a"]');
const threadB = thread.querySelector('[data-end="b"]');
const stacks = [...stage.querySelectorAll("[data-stack]")].map((s) => [...s.querySelectorAll(".ticket")]);
const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const lerp = (a, b, u) => a + (b - a) * u;

// ── Reading text ──
let hover = null;
function write(text) {
  if (readout.textContent !== text) readout.textContent = text;
}

// ── The run: one card at a time, in id order ──
// Times in seconds from the start of a card.
const T = { lift: 0.5, sweep: 1.7, print: 0.45, travel: 0.7, lower: 0.45 };
const broken = new Set();
let cur = 0, t0 = 0, dir = 1, auto = true, idle = 0;
let landed = D.bins.map(() => 0);
let ev = []; // evidence glows for the current card: {x, y, a}
let gx = D.sweep[1], beam = 0, lastLand = null, cycleEnd = 0;

function hash(a, b) {
  let h = 2166136261;
  for (const c of a + "/" + b) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}
// The rows a card's query touches: a few dots in each table it reads.
function evidenceOf(i) {
  const c = D.cards[i];
  const out = [];
  for (const t of c.tables) {
    const r = D.rows[t];
    for (let n = 0; n < (c.ticket ? 2 : 1); n++) {
      const h = hash(c.id, t * 7 + n);
      const col = 3 + (h % (r.cols - 6));
      const row = (h >>> 8) % r.rows;
      out.push({ x: r.x0 + col * r.gap, y: r.y0 + row * r.gap, a: 0, hit: false });
    }
  }
  return out;
}
function start(i, now) {
  cur = i;
  t0 = now;
  dir = -dir;
  ev = evidenceOf(i);
  const c = D.cards[i];
  const hue = broken.has(i) ? "error" : c.pillar;
  readLamp.setAttribute("data-hue", hue);
  write(`${c.title} · ${c.detects}`);
  // The last ticket's thread lets go as the next card comes up.
  thread.setAttribute("opacity", "0");
}
function select(i, now) {
  auto = false;
  clearTimeout(idle);
  idle = setTimeout(() => { auto = !still.matches; }, 6000);
  if (i !== cur || now - t0 > 1) start(i, now);
}
function resetTray() {
  landed = D.bins.map(() => 0);
  stacks.forEach((s) => s.forEach((t) => t.removeAttribute("data-in")));
  thread.setAttribute("opacity", "0");
}

// ── Pointer and keys ──
const inside = (pt, poly) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
// The gantry's hit area follows it.
function gantryHull() {
  const { y0, y1, z1 } = D.gantryHull;
  const pts = [];
  for (const x of [gx - 6, gx + 6]) for (const y of [y0, y1]) for (const z of [D.bed.z, z1]) pts.push(iso([x, y, z], P));
  const minX = Math.min(...pts.map((p) => p[0])), maxX = Math.max(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1])), maxY = Math.max(...pts.map((p) => p[1]));
  return [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
}
stage.addEventListener("pointermove", (e) => {
  const r = svg.getBoundingClientRect();
  const pt = [((e.clientX - r.left) / r.width) * D.W, ((e.clientY - r.top) / r.height) * D.H];
  // Cards overlap; the nearest one under the pointer (painted last) is the one you see.
  const ci = D.cards.findLastIndex((c, i) => inside(pt, liftedHull(i)));
  if (ci >= 0) {
    hover = null;
    stage.style.cursor = "pointer";
    if (ci !== cur) select(ci, performance.now());
    return;
  }
  stage.style.cursor = "";
  let hit = null;
  for (const s of D.stations) if (inside(pt, s.hull)) hit = s;
  if (!hit && inside(pt, gantryHull())) hit = { id: "engine", read: D.engineRead };
  hover = hit;
  if (hit) write(hit.read);
});
stage.addEventListener("pointerleave", () => { hover = null; stage.style.cursor = ""; });
stage.addEventListener("keydown", (e) => {
  const n = D.cards.length;
  const now = performance.now();
  if (e.key === "ArrowRight" || e.key === "ArrowDown") select((cur + 1) % n, now);
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") select((cur + n - 1) % n, now);
  else if (e.key === "f" || e.key === "F") {
    if (broken.has(cur)) broken.delete(cur); else broken.add(cur);
    cards[cur].toggleAttribute("data-broken", broken.has(cur));
    select(cur, now - 2000);
    start(cur, now);
  } else return;
  e.preventDefault();
});
const lifts = D.cards.map(() => 0);
function liftedHull(i) {
  const dy = -iso([0, 0, lifts[i]], P)[1] + iso([0, 0, 0], P)[1];
  return D.cards[i].hull.map(([x, y]) => [x, y - dy * (y < cardMid(i) ? 1 : 0)]);
}
const mids = D.cards.map((c) => c.hull.reduce((s, p) => s + p[1], 0) / c.hull.length);
const cardMid = (i) => mids[i];

// ── The light: beam and evidence, a WebGL layer in the figure's camera ──
const N = 8;
const FRAGMENT = `
uniform float uG[${N * 4}];
uniform float uLight;
uniform float uGX;
uniform float uBeam;
uniform vec3 uHue;
uniform vec4 uBed;
uniform vec2 uZ;
vec4 inkFor(vec3 seen,float cover){vec3 ab=1.-seen;float a=max(max(ab.r,max(ab.g,ab.b)),cover);return vec4(vec3(a)-ab,a);}
vec4 over(vec4 top,vec4 under){return top+under*(1.-top.a);}
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  float px=pixelOf()/uCam.z;
  vec3 fl=onFloor(vb,uZ.x);
  float onBed=window(fl.x,uBed.x-2.,uBed.y+2.,.8*px)*window(fl.y,uBed.z-1.,uBed.w+1.,.8*px);
  // The sheet of light from the lens down to the bed, in the plane x = uGX.
  vec3 w=onWallX(vb,uGX);
  float sheet=window(w.y,uBed.z,uBed.w,1.2)*window(w.z,uZ.x,uZ.y,.6);
  sheet*=.22+.5*smoothstep(uZ.y,uZ.x,w.z);
  // Where it meets the bed: a bright line across the panels, and a soft wash either side.
  float dx=fl.x-uGX;
  float line=exp(-dx*dx/1.1)*onBed;
  float wash=exp(-dx*dx/60.)*onBed*.35;
  vec3 emit=uHue*(sheet+wash)*uBeam+mix(uHue,vec3(1.),.45)*line*uBeam*1.3;
  float glow=0.;float core=0.;
  for(int i=0;i<${N};i++){
    float a=uG[i*4+2];
    if(a<.002)continue;
    vec2 d=fl.xy-vec2(uG[i*4],uG[i*4+1]);
    float r2=dot(d,d);
    glow+=exp(-r2/14.)*a*onBed;
    core+=exp(-r2/1.3)*a*onBed;
  }
  emit+=uHue*glow*1.2+vec3(1.)*core*.8;
  // On paper: the same light as a coloured ink, deepest where it is brightest.
  float inkA=clamp((sheet+wash)*uBeam*.9+line*uBeam+glow*1.1,0.,1.);
  vec3 seen=mix(vec3(1.),uHue,clamp(inkA,0.,.85));
  seen=mix(seen,mix(uHue,vec3(1.),.6),clamp(core,0.,1.));
  vec4 ink=inkFor(seen,clamp(core*.7,0.,1.));
  vec3 col=tonemap(emit,1.3);
  vec4 dark=vec4(col,max(col.r,max(col.g,col.b)));
  vec4 outc=mix(dark,ink,uLight);
  float n=(hash12(gl_FragCoord.xy+fract(uTime*.61)*91.)+hash12(gl_FragCoord.yx*1.37+fract(uTime*.37)*57.)-1.)/255.;
  outc=max(outc+n*smoothstep(0.,1.5/255.,outc.a),0.);
  outc.rgb=min(outc.rgb,vec3(outc.a));
  gl_FragColor=outc;
}`;
const HUES = { ...D.hues, error: [0.851, 0.325, 0.31] };
const layer = glLayer({
  canvas: q(".fx-gl"),
  fragment: FRAGMENT,
  view: [D.W, D.H],
  camera: D.camera,
  uniforms: ["uG", "uGX", "uBeam", "uHue"],
  fixed: { uLight: LIGHT, uBed: [D.bed.x0, D.bed.x1, D.bed.y0, D.bed.y1], uZ: [D.bed.z, D.bed.lens] },
});
if (layer) stage.setAttribute("data-gl", "");
const glows = new Float32Array(N * 4);
let hueNow = HUES[D.cards[0].pillar].slice();

// ── The loop ──
let frame = 0, last = 0, clock = 0, visible = false;
const place = (el, p) => el.setAttribute("transform", translateAlong(P, p));
function threadTo(bin, e) {
  const top = D.stackZ[Math.max(landed[bin] - 1, 0)];
  const a = [D.bins[bin] + D.ticket.w / 2 - 3, 0, top];
  const b = [e.x, e.y, D.bed.z];
  const pa = iso(a, P), pb = iso(b, P);
  const c1 = iso([a[0], a[1], 116], P), c2 = iso([b[0], b[1], 96], P);
  // Behind the gantry (farther along x than the reader is), the gantry hides it.
  if (e.x < gx) thread.setAttribute("mask", "url(#behind-gantry)"); else thread.removeAttribute("mask");
  threadPath.setAttribute("d", `M${pa[0].toFixed(1)} ${pa[1].toFixed(1)}C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${pb[0].toFixed(1)} ${pb[1].toFixed(1)}`);
  threadA.setAttribute("cx", pa[0].toFixed(1)); threadA.setAttribute("cy", pa[1].toFixed(1));
  threadB.setAttribute("cx", pb[0].toFixed(1)); threadB.setAttribute("cy", pb[1].toFixed(1));
  thread.setAttribute("opacity", "1");
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  clock += dt;
  const calm = still.matches;
  const c = D.cards[cur];
  const isBroken = broken.has(cur);
  const ticket = isBroken ? { bin: 3, text: `error · Rule failed: ${c.id} (the other rules still ran)` } : c.ticket;
  const u = (now - t0) / 1000;
  const tSweep = T.lift, tPrint = T.lift + (isBroken ? 0.35 : T.sweep), tTravel = tPrint + T.print, tLand = tTravel + T.travel;
  const tLower = ticket ? tLand + 0.2 : tPrint + 0.3;
  const tNext = tLower + T.lower + 0.5;

  // The card lifts, waits, and settles back.
  for (let i = 0; i < cards.length; i++) {
    const want = i === cur && u < tLower ? D.lift : 0;
    lifts[i] = calm ? want : lifts[i] + (want - lifts[i]) * (1 - Math.exp(-dt / 0.14));
    cards[i].setAttribute("transform", translateAlong(P, [0, 0, lifts[i]]));
    cards[i].toggleAttribute("data-reading", i === cur);
  }
  // The gantry sweeps the bed while the card is up; a broken query stops at once.
  const from = dir > 0 ? D.sweep[0] : D.sweep[1], to = dir > 0 ? D.sweep[1] : D.sweep[0];
  const su = isBroken ? Math.min(Math.max((u - tSweep) / T.sweep, 0), 0.12) : ease((u - tSweep) / T.sweep);
  gx = calm ? (D.sweep[0] + D.sweep[1]) / 2 : lerp(from, to, su);
  place(gBack, [gx, 0, 0]);
  place(gFront, [gx, 0, 0]);
  const beamWant = calm ? 1 : (u > tSweep && u < tPrint ? 1 : 0);
  beam += (beamWant - beam) * (1 - Math.exp(-dt / 0.12));
  readLamp.toggleAttribute("data-on", beamWant > 0);
  const hueWant = HUES[isBroken ? "error" : c.pillar];
  for (let k = 0; k < 3; k++) hueNow[k] += (hueWant[k] - hueNow[k]) * (1 - Math.exp(-dt / 0.2));
  // Rows light as the beam passes them, and fade once the card is back.
  glows.fill(0);
  ev.forEach((e, n) => {
    if (!isBroken && (calm || (dir > 0 ? gx >= e.x : gx <= e.x)) && u > tSweep) e.hit = true;
    const want = e.hit && u < tNext - 0.2 ? 1 : 0;
    e.a += (want - e.a) * (1 - Math.exp(-dt / 0.18));
    // Only rows a query matches light up; a rule that finds nothing lights nothing.
    if (n < N) glows.set([e.x, e.y, c.ticket ? e.a : 0, 0], n * 4);
  });
  if (!hover) {
    if (calm) write(ticket ? ticket.text : `${c.id} · no rows, so no finding`);
    else if (u > tSweep && u < tPrint) write(isBroken ? `${c.id} · the query fails` : `${c.id} · reading ${c.reads}`);
    else if (u >= tPrint) write(ticket ? ticket.text : `${c.id} · no rows, so no finding`);
  }
  // The ticket: out of the slot, across, and down into its compartment.
  if (ticket && u >= tPrint && u < tLand) {
    const half = D.ticket.w / 2;
    const bx = D.bins[ticket.bin];
    let p, op = 1;
    if (u < tTravel) {
      const v = ease((u - tPrint) / T.print);
      p = [D.slot.x + 1 + half * v, 0, D.slot.z - 2];
      op = Math.min(1, v * 3);
    } else {
      const v = ease((u - tTravel) / T.travel);
      const top = D.stackZ[Math.min(landed[ticket.bin], D.stackMax - 1)];
      p = [lerp(D.slot.x + 1 + half, bx, v), 0, lerp(D.slot.z - 2, top + 2, v) + Math.sin(v * Math.PI) * 6];
    }
    place(fly, p);
    fly.style.opacity = op.toFixed(2);
    fly.setAttribute("data-bin", ticket.bin);
    feedLamp.toggleAttribute("data-on", u < tTravel);
  } else {
    fly.style.opacity = "0";
    feedLamp.removeAttribute("data-on");
  }
  if (ticket && u >= tLand && lastLand !== t0) {
    lastLand = t0;
    if (landed[ticket.bin] < D.stackMax) stacks[ticket.bin][landed[ticket.bin]].setAttribute("data-in", "");
    landed[ticket.bin] = Math.min(landed[ticket.bin] + 1, D.stackMax);
    if (ticket.bin === 3) { errLamp.setAttribute("data-on", ""); setTimeout(() => errLamp.removeAttribute("data-on"), 1400); }
    // An error finding has no evidence, so it has no thread.
    if (ev.length && ticket.bin !== 3) threadTo(ticket.bin, ev[0]);
  }
  // Next card; after the last one the tray empties and the run starts again.
  if (!calm && u >= tNext) {
    if (auto) {
      if (cur === cards.length - 1) {
        if (!cycleEnd) { cycleEnd = now; write(`${landed.reduce((a, b) => a + b, 0)} findings, sorted high, medium, low, error`); }
        if (now - cycleEnd > 2600) { cycleEnd = 0; resetTray(); start(0, now); }
      } else start(cur + 1, now);
    }
  }
  // The cache dial: one turn every ten seconds.
  needle.setAttribute("transform", `rotate(${((calm ? 0.3 : (clock % 10) / 10) * 360 - 90).toFixed(1)})`);
  if (layer) layer.draw({ uG: glows, uGX: gx, uBeam: beam, uHue: hueNow }, calm ? 0.8 : clock);
  frame = visible ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);

if (still.matches) {
  // A still frame that still tells the story: one card read, its rows lit, tickets in the tray.
  auto = false;
  const i = D.cards.findIndex((c) => c.ticket && c.ticket.severity === "high");
  start(i, performance.now());
  ev.forEach((e) => { e.hit = true; e.a = 1; });
  [[0, 2], [1, 3], [2, 1]].forEach(([b, n]) => { for (let j = 0; j < n; j++) stacks[b][j].setAttribute("data-in", ""); landed[b] = n; });
  threadTo(0, ev[0]);
} else start(0, performance.now());
