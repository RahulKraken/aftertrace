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
  const post = () => window.parent.postMessage({ figure: "system", height: Math.ceil(page.getBoundingClientRect().height) }, "*");
  new ResizeObserver(post).observe(page);
}

// ── Stations: point at one to read it; idle, a tour walks them in order ──
const inside = (pt, poly) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
let focus = null, tour = 0, touring = true, idle = 0;
const state = { content: false, ask: false };
function setFocus(id) {
  if (focus === id) return;
  focus = id;
  if (id) stage.setAttribute("data-focus", id); else stage.removeAttribute("data-focus");
  const s = D.stations.find((x) => x.id === id);
  write(s ? `${s.label} · ${s.read}` : "");
}
function write(text) {
  if (!text) text = `${state.content ? "Content kept" : "Content dropped"} · Ask ${state.ask ? "on" : "off"}`;
  if (readout.textContent !== text) readout.textContent = text;
}
function pause() {
  touring = false;
  clearTimeout(idle);
  idle = setTimeout(() => { touring = !still.matches; }, 5000);
}
stage.addEventListener("pointermove", (e) => {
  const r = svg.getBoundingClientRect();
  const pt = [((e.clientX - r.left) / r.width) * D.W, ((e.clientY - r.top) / r.height) * D.H];
  // The last station in the list wins where hulls overlap (the carriage sits on the cabinet).
  let hit = null;
  for (const s of D.stations) if (inside(pt, s.hull)) hit = s.id;
  if (hit) { pause(); setFocus(hit); }
});
stage.addEventListener("pointerleave", () => pause());
stage.addEventListener("click", () => {
  if (focus === "redact") toggle("content");
  else if (focus === "ask") toggle("ask");
});
stage.addEventListener("keydown", (e) => {
  const ids = D.stationIds;
  const i = Math.max(0, ids.indexOf(focus));
  if (e.key === "ArrowRight" || e.key === "ArrowDown") setFocus(ids[(i + 1) % ids.length]);
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") setFocus(ids[(i + ids.length - 1) % ids.length]);
  else if (e.key === "c" || e.key === "C") toggle("content");
  else if (e.key === "a" || e.key === "A") toggle("ask");
  else return;
  e.preventDefault();
  pause();
});
function toggle(which) {
  state[which] = !state[which];
  const part = q(which === "content" ? '[data-part="lever-content"]' : '[data-part="outbox"]');
  part.setAttribute("data-state", state[which] ? "on" : "off");
  setFocus(which === "content" ? "redact" : "ask");
  const s = D.stations.find((x) => x.id === focus);
  write(which === "content"
    ? (state.content ? "Redaction · content kept, identity still out" : "Redaction · content dropped at the door")
    : (state.ask ? "Ask · on: only schema and query rows go out" : "Ask · off: nothing leaves this machine"));
}

// ── Batches of light: born at a source, run the first trough, pass the sieve, run the second, filed in a drawer ──
const SPEED = 40; // world units a second along a trough
const [R1, R2] = D.trough.runs;
const HUE = ["model", "tool", "wait"]; // traces, logs, metrics
const DRAWER_OF = [0, 2, 3]; // spans (and span events), events, metric points
const lamps = [0, 1, 2].map((i) => q(`[data-part="lamp-${i}"]`));
const rx = [...stage.querySelectorAll('[data-part^="rx-"]')];
const drawers = [...Array(D.drawers)].map((_, i) => q(`[data-part="drawer-${i}"]`));
const insides = [...Array(D.drawers)].map((_, i) => q(`[data-part="drawer-in-${i}"]`));
const clipsOf = [...Array(D.drawers)].map((_, i) => q(`[data-clip="${i}"]`));
// The part of a drawer that has come out past the cabinet face, as a screen outline.
function exposed(b, open) {
  const pts = [];
  for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y0 + open]) for (const z of [b.z0, b.z1]) pts.push(iso([x, y, z], P));
  pts.sort((a, c) => a[0] - c[0] || a[1] - c[1]);
  const cross = (o, a, c) => (a[0] - o[0]) * (c[1] - o[1]) - (a[1] - o[1]) * (c[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.slice().reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const h = lo.slice(0, -1).concat(up.slice(0, -1));
  return open < 0.05 ? "M0 0Z" : "M" + h.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L") + "Z";
}
const cards = [...stage.querySelectorAll(".card")];
let batches = [], born = 0, filed = 0, found = 0, spawnAt = 0;
const blink = (el, ms = 320) => { if (!el) return; el.setAttribute("data-on", ""); setTimeout(() => el.removeAttribute("data-on"), ms); };
function spawn(now) {
  const kind = [0, 0, 1, 0, 2, 1][born % 6]; // traces arrive most often
  batches.push({ kind, t: now, src: born % 3 });
  blink(lamps[born % 3]);
  blink(rx[kind === 0 ? 0 : 1]);
  born++;
}
// Where a batch is, and how bright: x along the bench, alpha fading in and out at each end.
function place(b, now) {
  const age = (now - b.t) / 1000;
  const l1 = (R1[1] - R1[0]) / SPEED, gap = 0.55, l2 = (R2[1] - R2[0]) / SPEED;
  const fade = (u, len) => Math.min(1, u / 0.18, (len - u) / 0.18);
  if (age < l1) return { x: R1[0] + age * SPEED, a: fade(age, l1), size: 1 };
  if (age < l1 + gap) return { x: 0, a: 0, size: 1, inSieve: true };
  const u = age - l1 - gap;
  // Without --store-content the sieve keeps the content back, so less comes out the other side.
  if (u < l2) return { x: R2[0] + u * SPEED, a: fade(u, l2) * (state.content ? 1 : 0.62), size: state.content ? 1 : 0.8 };
  return null;
}

// ── The light: a WebGL layer in the figure's own camera ──
const N = 12;
const FRAGMENT = `
uniform float uO[${N * 4}];
uniform float uLight;
uniform vec3 uHM, uHT, uHW;
uniform vec2 uZ;
uniform vec4 uRun1, uRun2;
vec3 hueOf(float h){return h<.5?uHM:(h<1.5?uHT:uHW);}
vec4 inkFor(vec3 seen,float cover){vec3 ab=1.-seen;float a=max(max(ab.r,max(ab.g,ab.b)),cover);return vec4(vec3(a)-ab,a);}
vec4 over(vec4 top,vec4 under){return top+under*(1.-top.a);}
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  vec3 V=towardViewer();
  vec3 r0=rayOf(vb);
  vec3 fl=onFloor(vb,uZ.y);
  float px=pixelOf()/uCam.z;
  float inTrough=window(fl.y,-7.,7.,.7*px)*max(window(fl.x,uRun1.x,uRun1.y,.7*px),window(fl.x,uRun2.x,uRun2.y,.7*px));
  vec3 emit=vec3(0.);
  vec4 ink=vec4(0.);
  for(int i=0;i<${N};i++){
    float a=uO[i*4+2];
    if(a<.002)continue;
    vec3 c=vec3(uO[i*4],0.,uZ.x);
    float s=uO[i*4+3];
    vec3 h=hueOf(uO[i*4+1]);
    vec3 w=c-r0;float t=dot(w,V);float d=length(c-(r0+t*V));
    float core=exp(-pow(d/(2.1*s),2.));
    float body=exp(-pow(d/(4.6*s),2.));
    float halo=exp(-pow(d/(10.*s),2.))*.32;
    vec2 off=(fl.xy-c.xy)*vec2(.55,1.);
    float pool=exp(-dot(off,off)/90.)*inTrough*.55;
    emit+=h*(body*1.1+halo+pool)*a+vec3(1.)*core*.9*a;
    // On paper: the floor takes a tint, the orb is a saturated body with a pale core.
    vec3 seenPool=mix(vec3(1.),mix(vec3(1.),h,.5),pool*a*1.4);
    vec3 seenBody=mix(vec3(1.),h,clamp((body*1.05+halo)*a,0.,1.));
    seenBody=mix(seenBody,mix(h,vec3(1.),.72),clamp(core*a,0.,1.));
    vec4 o=over(inkFor(seenBody,core*a*.85),inkFor(seenPool,0.));
    ink=over(o,ink);
  }
  vec4 dark;
  vec3 col=tonemap(emit,1.25);
  float m=max(col.r,max(col.g,col.b));
  dark=vec4(col,m);
  vec4 outc=mix(dark,ink,uLight);
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
  fixed: { uLight: LIGHT, uHM: D.hues.model, uHT: D.hues.tool, uHW: D.hues.wait, uZ: [D.orbZ, D.trough.z], uRun1: [R1[0], R1[1], 0, 0], uRun2: [R2[0], R2[1], 0, 0] },
});
if (layer) stage.setAttribute("data-gl", "");
const orbs = new Float32Array(N * 4);

// ── The loop ──
const carriage = q('[data-part="carriage"]');
let frame = 0, last = 0, clock = 0, visible = false, tourClock = 0;
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  clock += dt;
  const calm = still.matches;
  if (!calm && now >= spawnAt) { spawn(now); spawnAt = now + 820; }
  // Move every batch; file it when it reaches the cabinet.
  orbs.fill(0);
  let n = 0;
  batches = batches.filter((b) => {
    const at = place(b, now);
    if (!at) {
      filed++;
      const lamp = drawers[DRAWER_OF[b.kind]];
      if (lamp) blink(lamp, 260);
      if (filed % 7 === 0) { cards[found % cards.length].setAttribute("data-in", ""); found++; if (found % cards.length === 0) setTimeout(() => cards.forEach((c) => c.removeAttribute("data-in")), 2400); }
      return false;
    }
    if (n < N && at.a > 0.002) { orbs.set([at.x, b.kind, at.a, at.size], n * 4); n++; }
    return true;
  });
  // The reading carriage sweeps the cabinet, back and forth.
  const sweep = calm ? 0.5 : 0.5 - 0.5 * Math.cos(clock * 0.9);
  carriage.setAttribute("transform", translateAlong(P, [D.carriage[0] + (D.carriage[1] - D.carriage[0]) * sweep, 0, 0]));
  // Drawers open while the store is the station in focus.
  drawers.forEach((dr, i) => {
    const want = focus === "store" ? 18 : 0;
    const cur = Number(dr.dataset.open || 0);
    const next = calm ? want : cur + (want - cur) * (1 - Math.exp(-dt / (0.22 + i * 0.05)));
    dr.dataset.open = String(next);
    const tr = translateAlong(P, [0, next, 0]);
    dr.setAttribute("transform", tr);
    insides[i].setAttribute("transform", tr);
    clipsOf[i].setAttribute("d", exposed(D.drawerBox[i], next));
  });
  if (touring) {
    tourClock += dt;
    if (tourClock > 3.2) { tourClock = 0; tour = (tour + 1) % D.stationIds.length; setFocus(D.stationIds[tour]); }
  }
  if (layer) layer.draw({ uO: orbs }, calm ? 0.8 : clock);
  frame = visible ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
if (still.matches) {
  touring = false;
  // A still frame that still tells the story: one batch in each trough.
  batches = [{ kind: 0, t: performance.now() - 900 }, { kind: 2, t: performance.now() - 2600 }];
}
setFocus(D.stationIds[0]);
