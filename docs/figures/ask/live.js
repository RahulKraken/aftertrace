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
  const post = () => window.parent.postMessage({ figure: "ask", height: Math.ceil(document.body.getBoundingClientRect().height) }, "*");
  new ResizeObserver(post).observe(document.body);
}

// ── Parts: point at one to read it ──
const inside = (pt, poly) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
let focus = null, story = "";
function setFocus(id) {
  if (focus === id) return;
  focus = id;
  if (id) stage.setAttribute("data-focus", id); else stage.removeAttribute("data-focus");
  const s = D.stations.find((x) => x.id === id);
  if (s) put(`${s.label} · ${s.read}`);
}
// The readout tells the story; pointing at a part reads that part instead.
function put(text) { if (readout.textContent !== text) readout.textContent = text; }
function say(text) { story = text; if (!focus) put(text); }
const hitAt = (e) => {
  const r = svg.getBoundingClientRect();
  const pt = [((e.clientX - r.left) / r.width) * D.W, ((e.clientY - r.top) / r.height) * D.H];
  let hit = null;
  for (const s of D.stations) if (inside(pt, s.hull)) hit = s.id;
  return hit;
};

// ── Moving parts ──
const plates = ["plate-out", "plate-in", "lift-bar", "hasp"].map((p) => q(`[data-part="${p}"]`));
const padlock = q('[data-part="padlock"]');
const head = q('[data-part="head"]');
const blade = q('[data-part="blade"]');
const needle = q('[data-part="needle"] line');
const answer = q('[data-part="answer"]');
const typed = [...stage.querySelectorAll(".fig-type")];
const drawers = [...stage.querySelectorAll('[data-part^="drawer-"]')];
const stampLamp = q('[data-part="stamp-lamp"]');
const tpLamp = q('[data-part="tp-lamp"]');
const blink = (el, ms = 320, hue) => {
  if (!el) return;
  if (hue) el.setAttribute("data-hue", hue);
  el.setAttribute("data-on", "");
  setTimeout(() => el.removeAttribute("data-on"), ms);
};
const cx = Number(needle.getAttribute("x1")), cy = Number(needle.getAttribute("y1")) - 1.6;

let open = 0, wantOpen = false, dial = 0, dialAt = D.sweep[0], press = -9, chop = -9, typing = -9;
let clock = 0;

// ── Timeline: everything waits on the figure's own clock, so it pauses offscreen ──
let jobs = [];
const later = (sec, fn) => jobs.push({ at: clock + sec, fn });

// ── Light: slips in the channels. Each runs a path at a steady speed. ──
const SPEED = 120;
const GLOW = 1.55; // this bench is drawn smaller than Fig 1's, so each slip glows a little larger
const HUE = { model: 0, tool: 1, wait: 2, error: 3 };
const X = D.x, Y = D.lane, CAB_FRONT = -26 + 52, CAB_BACK = -26;
const OUT_FROM = (x, y0) => [[x, y0], [x, Y.out], [X.tp, Y.out]];
let slips = [];
function send(path, hue, size, marks = [], done) {
  let len = 0;
  const seg = [];
  for (let i = 1; i < path.length; i++) { const l = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); seg.push(l); len += l; }
  slips.push({ path, seg, len, t: clock, hue: HUE[hue], size, marks: marks.sort((a, b) => a.s - b.s), done });
}
// Distance along a path at which it first reaches x (on a straight run).
const along = (path, x) => {
  let s = 0;
  for (let i = 1; i < path.length; i++) {
    const [a, b] = [path[i - 1], path[i]];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) return s + (Math.abs(x - a[0]) / Math.abs(b[0] - a[0])) * l;
    s += l;
  }
  return s;
};
function where(sl, s) {
  let i = 0;
  while (i < sl.seg.length - 1 && s > sl.seg[i]) { s -= sl.seg[i]; i++; }
  const [a, b] = [sl.path[i], sl.path[i + 1]];
  const f = Math.min(1, s / sl.seg[i]);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

// ── The example: one question, a mistake, a fix, an answer ──
const Q = "Which tools wait on me for approval the most?";
const SQL1 = "SELECT tool_name, sum(wait_seconds) FROM tools GROUP BY 1";
const SQL2 = "SELECT tool_name, round(sum(wait_ms)/1000) AS waited_s FROM tools GROUP BY 1 ORDER BY 2 DESC";
let run = 0; // bumps on every reset, so stale callbacks do nothing
const live = (id, fn) => () => { if (id === run) fn(); };
function reset() {
  run++;
  slips = [];
  jobs = [];
  dial = 0;
  answer.removeAttribute("data-on");
  typed.forEach((t) => t.removeAttribute("data-on"));
}
function think(id, then) {
  // The model types for a moment, its lamp on, then sends what it wrote.
  typing = clock;
  tpLamp.setAttribute("data-on", "");
  typed.forEach((t, i) => later(0.18 * (i + 1), live(id, () => t.setAttribute("data-on", ""))));
  later(1.1, live(id, () => { tpLamp.removeAttribute("data-on"); typed.forEach((t) => t.removeAttribute("data-on")); then(); }));
}
const toStore = [[X.tp, Y.in], [X.port, Y.in], [X.port, CAB_FRONT]];
const toScreen = [[X.tp, Y.in], [X.term, Y.in]];
const stampMark = (path, ok, text) => ({ s: along(path, X.stamp), fn: () => { press = clock; blink(stampLamp, 600, ok ? "tool" : "error"); say(text); } });
function ask() {
  reset();
  const id = run;
  if (!wantOpen) { say("Ask is off · press A, or start serve with --ask and a key"); return; }
  if (still.matches) return stillFrame();
  say(`You ask: “${Q}”`);
  let arrived = 0;
  const both = () => { if (++arrived === 2) call(id, 1); };
  send(OUT_FROM(X.term, Y.out), "model", 1.0, [{ s: 60, fn: live(id, () => say("Your question and the schema go out: tables, columns, span and event names")) }], both);
  later(0.35, live(id, () => send(OUT_FROM(X.port, CAB_BACK), "model", 1.2, [], both)));
}
function call(id, n) {
  if (id !== run) return;
  dial = n;
  say(n === 1 ? `Call 1 of up to ${D.ask.steps} · ${D.ask.model} reads the question and the schema` : `Call ${n} of up to ${D.ask.steps} · the model reads what came back`);
  think(id, () => {
    if (n === 1) {
      say(`run_sql · ${SQL1}`);
      send(toStore, "tool", 1.0, [stampMark(toStore, true, "Read-only check · one SELECT, so it may run")], live(id, () => {
        blink(drawers[0], 400);
        say("DuckDB: there is no column wait_seconds · the error goes back to the model");
        send(OUT_FROM(X.port, CAB_BACK), "error", 0.8, [], live(id, () => call(id, 2)));
      }));
    } else if (n === 2) {
      say(`run_sql · ${SQL2}`);
      send(toStore, "tool", 1.0, [stampMark(toStore, true, "Read-only check · one SELECT, so it may run")], live(id, () => {
        drawers.forEach((d, i) => setTimeout(() => blink(d, 300), i * 90));
        say("It runs on the store in a transaction that is rolled back · 23 rows");
        const path = OUT_FROM(X.port, CAB_BACK);
        send(path, "model", 1.55, [{ s: along(path, X.cut), fn: () => { chop = clock; say(`The cutter: at most ${D.ask.rows} rows, every string cut to ${D.ask.cell} characters`); } }], live(id, () => call(id, 3)));
      }));
    } else {
      say("final_answer · with the one query that backs it");
      send(toScreen, "wait", 1.0, [
        stampMark(toScreen, true, "Its SQL passes the same check and runs again here, for your table"),
        { s: along(toScreen, X.port), fn: () => drawers.forEach((d, i) => setTimeout(() => blink(d, 260), i * 70)) },
      ], live(id, () => {
        answer.setAttribute("data-on", "");
        say("Answer · Bash(npm test:*) waited on you longest: 4 min over 31 prompts");
        later(6, live(id, () => { if (touring) { setOpen(false); say("Locked again · nothing leaves this machine"); later(3, live(id, () => { if (touring) { setOpen(true); later(1.2, () => touring && ask()); } })); } }));
      }));
    }
  });
}
// W: what a write looks like. The press refuses it and the refusal goes back.
function refuse() {
  reset();
  const id = run;
  if (!wantOpen) { say("Ask is off · open the gate first (A)"); return; }
  const path = [[X.tp, Y.in], [X.chute, Y.in], [X.chute, Y.out], [X.tp, Y.out]];
  say("Suppose the model sent DELETE FROM spans");
  if (still.matches) { say(`Refused: “${D.readOnly}” · that goes back to the model as an error`); return; }
  dial = 1;
  send(path, "tool", 1.0, [{ s: along(path, X.stamp), fn: (sl) => { press = clock; blink(stampLamp, 900, "error"); say(`Refused: “${D.readOnly}”`); sl.hue = HUE.error; } }, { s: along(path, X.chute) + 20, fn: () => say("The refusal goes back to the model as an error · nothing ran") }], live(id, () => later(2, live(id, () => say("Ask is on · Space asks the example question again")))));
}
function setOpen(v) {
  wantOpen = v;
  padlock.setAttribute("data-state", v ? "on" : "off");
  if (!v) { reset(); say("Ask is off · the gate is down, nothing leaves"); }
}
function stillFrame() {
  dial = 3;
  answer.setAttribute("data-on", "");
  say("Out: question, schema, trimmed rows · In: checked SQL, the answer");
}

// ── Input ──
let touring = true, idle = 0;
function pause() {
  touring = false;
  clearTimeout(idle);
  idle = setTimeout(() => { touring = !still.matches; if (touring && !slips.length && !jobs.length) { if (!wantOpen) setOpen(true); later(0.6, () => touring && ask()); } }, 9000);
}
const act = (id) => {
  if (id === "gate") { setOpen(!wantOpen); if (wantOpen) say("Ask is on · the gate is up · Space asks a question"); }
  else if (id === "stamp") refuse();
  else ask();
};
stage.addEventListener("pointermove", (e) => {
  const hit = hitAt(e);
  stage.style.cursor = hit ? "pointer" : "";
  if (hit) setFocus(hit);
});
stage.addEventListener("pointerleave", () => { setFocus(null); put(story); });
stage.addEventListener("click", (e) => { const hit = hitAt(e); if (!hit) return; pause(); act(hit); });
stage.addEventListener("keydown", (e) => {
  const ids = D.stationIds;
  const i = Math.max(0, ids.indexOf(focus));
  if (e.key === "ArrowRight" || e.key === "ArrowDown") setFocus(ids[(i + 1) % ids.length]);
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") setFocus(ids[(i + ids.length - 1) % ids.length]);
  else if (e.key === "a" || e.key === "A") act("gate");
  else if (e.key === " ") { if (!wantOpen) setOpen(true); ask(); }
  else if (e.key === "w" || e.key === "W") refuse();
  else if (e.key === "Enter" && focus) act(focus);
  else if (e.key === "Escape") { setFocus(null); put(story); }
  else return;
  e.preventDefault();
  pause();
});

// ── The light: one WebGL layer per channel, in the figure's own camera ──
const N = 8;
const lanes = `
float inLane(vec2 p,float px){
  float a=window(p.y,${(Y.out - D.half).toFixed(1)},${(Y.out + D.half).toFixed(1)},.7*px)*window(p.x,${X.term.toFixed(1)},${X.tp.toFixed(1)},.7*px);
  float b=window(p.y,${(Y.in - D.half).toFixed(1)},${(Y.in + D.half).toFixed(1)},.7*px)*window(p.x,${X.term.toFixed(1)},${X.tp.toFixed(1)},.7*px);
  float c=window(p.x,${(X.chute - D.half).toFixed(1)},${(X.chute + D.half).toFixed(1)},.7*px)*window(p.y,${Y.out.toFixed(1)},${Y.in.toFixed(1)},.7*px);
  float d=window(p.x,${(X.port - 6).toFixed(1)},${(X.port + 6).toFixed(1)},.7*px)*(window(p.y,${CAB_BACK - 8}.,${Y.out}.,.7*px)+window(p.y,${Y.in}.,${CAB_FRONT + 8}.,.7*px));
  return clamp(a+b+c+d,0.,1.);
}`;
const FRAGMENT = `
uniform float uO[${N * 5}];
uniform float uLight;
uniform vec3 uH0, uH1, uH2, uH3;
uniform vec2 uZ;
vec3 hueOf(float h){return h<.5?uH0:(h<1.5?uH1:(h<2.5?uH2:uH3));}
vec4 inkFor(vec3 seen,float cover){vec3 ab=1.-seen;float a=max(max(ab.r,max(ab.g,ab.b)),cover);return vec4(vec3(a)-ab,a);}
vec4 over(vec4 top,vec4 under){return top+under*(1.-top.a);}
${lanes}
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  vec3 V=towardViewer();
  vec3 r0=rayOf(vb);
  vec3 fl=onFloor(vb,uZ.y);
  float px=pixelOf()/uCam.z;
  float floorOk=inLane(fl.xy,px);
  vec3 emit=vec3(0.);
  vec4 ink=vec4(0.);
  for(int i=0;i<${N};i++){
    float a=uO[i*5+3];
    if(a<.002)continue;
    vec3 c=vec3(uO[i*5],uO[i*5+1],uZ.x);
    float s=uO[i*5+4];
    vec3 h=hueOf(uO[i*5+2]);
    vec3 w=c-r0;float t=dot(w,V);float d=length(c-(r0+t*V));
    float core=exp(-pow(d/(2.1*s),2.));
    float body=exp(-pow(d/(4.6*s),2.));
    float halo=exp(-pow(d/(10.*s),2.))*.32;
    vec2 off=fl.xy-c.xy;
    float pool=exp(-dot(off,off)/(70.*s*s))*floorOk*.55;
    emit+=h*(body*1.1+halo+pool)*a+vec3(1.)*core*.9*a;
    vec3 seenPool=mix(vec3(1.),mix(vec3(1.),h,.5),pool*a*1.4);
    vec3 seenBody=mix(vec3(1.),h,clamp((body*1.05+halo)*a,0.,1.));
    seenBody=mix(seenBody,mix(h,vec3(1.),.72),clamp(core*a,0.,1.));
    vec4 o=over(inkFor(seenBody,core*a*.85),inkFor(seenPool,0.));
    ink=over(o,ink);
  }
  vec3 col=tonemap(emit,1.25);
  float m=max(col.r,max(col.g,col.b));
  vec4 outc=mix(vec4(col,m),ink,uLight);
  float n=(hash12(gl_FragCoord.xy+fract(uTime*.61)*91.)+hash12(gl_FragCoord.yx*1.37+fract(uTime*.37)*57.)-1.)/255.;
  outc=max(outc+n*smoothstep(0.,1.5/255.,outc.a),0.);
  outc.rgb=min(outc.rgb,vec3(outc.a));
  gl_FragColor=outc;
}`;
const layers = ["out", "in"].map((lane) => glLayer({
  canvas: q(`.fx-gl[data-lane="${lane}"]`),
  fragment: FRAGMENT,
  view: [D.W, D.H],
  camera: D.camera,
  uniforms: ["uO"],
  fixed: { uLight: LIGHT, uH0: D.hues.model, uH1: D.hues.tool, uH2: D.hues.wait, uH3: D.hues.error, uZ: [D.orbZ, D.tz] },
}));
if (layers[0]) stage.setAttribute("data-gl", "");
const orbs = [new Float32Array(N * 5), new Float32Array(N * 5)];

// ── The loop ──
let frame = 0, last = 0, visible = false;
const bump = (t, len) => (t >= 0 && t < len ? Math.sin((Math.PI * t) / len) : 0);
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  clock += dt;
  const calm = still.matches;
  for (const j of jobs.splice(0).sort((a, b) => a.at - b.at)) { if (j.at <= clock) j.fn(); else jobs.push(j); }
  // The gate rises and falls on the lift bar.
  const want = wantOpen ? 1 : 0;
  open = calm ? want : open + (want - open) * (1 - Math.exp(-dt / 0.28));
  const lift = translateAlong(P, [0, 0, D.lift * open]);
  plates.forEach((p) => p.setAttribute("transform", lift));
  // The press and the blade come down when a slip passes under them.
  head.setAttribute("transform", translateAlong(P, [0, 0, -6 * bump(clock - press, 0.36)]));
  blade.setAttribute("transform", translateAlong(P, [0, 0, -9 * bump(clock - chop, 0.3)]));
  // The dial follows the call count.
  const target = D.sweep[0] + ((D.sweep[1] - D.sweep[0]) * dial) / D.steps;
  dialAt = calm ? target : dialAt + (target - dialAt) * (1 - Math.exp(-dt / 0.18));
  needle.parentNode.setAttribute("transform", `rotate(${dialAt.toFixed(2)} ${cx} ${cy})`);
  // Slips: move, fire marks, fade at both ends, and land.
  orbs[0].fill(0); orbs[1].fill(0);
  const n = [0, 0];
  // A slip that lands may send the next one, so new slips join after the pass.
  const moving = slips;
  slips = [];
  const kept = moving.filter((sl) => {
    const s = sl.fixed ?? (clock - sl.t) * SPEED;
    for (const m of sl.marks) if (!m.done && s >= m.s) { m.done = true; m.fn(sl); }
    if (s >= sl.len) { if (sl.done) sl.done(); return false; }
    const [x, y] = where(sl, s);
    const a = Math.min(1, s / 18, (sl.len - s) / 18);
    // The rows sheet is trimmed at the cutter: it leaves smaller than it came.
    const size = sl.size > 1.4 && x > X.cut ? 0.95 : sl.size;
    const k = y < Y.out + D.half + 3 ? 0 : 1;
    if (n[k] < N) { orbs[k].set([x, y, sl.hue, a, size * GLOW], n[k] * 5); n[k]++; }
    return true;
  });
  slips = kept.concat(slips);
  layers.forEach((l, i) => l && l.draw({ uO: orbs[i] }, calm ? 0.8 : clock));
  frame = visible ? requestAnimationFrame(tick) : 0;
}
const go = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) go(); }, { rootMargin: "120px 0px" }).observe(stage);

// Start locked; the tour opens the gate and asks the example question.
setOpen(false);
if (still.matches) {
  touring = false;
  setOpen(true);
  stillFrame();
  // One slip of each kind, stopped mid-channel.
  slips = [];
  const hold = (path, hue, size, at) => { send(path, hue, size); slips[slips.length - 1].fixed = at; };
  hold(OUT_FROM(X.port, CAB_BACK), "model", 0.95, 262); // on the bridge, leaving
  hold(toStore, "tool", 0.85, 120);
} else later(2.6, () => { if (touring) { setOpen(true); say("Ask is on · serve --ask with ANTHROPIC_API_KEY set lifts the gate"); later(1.6, () => touring && ask()); } });
