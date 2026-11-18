/* cita.js — Camino a la cita
   Un muñequito con una rosa va a su cita: avanza casilla a casilla
   cruzando parques, calles con tráfico, vías de tranvía y un río con
   troncos y nenúfares. El camino avanza solo: si se queda atrás, llega
   tarde. Cada fila nueva suma 1 y, cuanto más lejos, más difícil.
   Reto: 3 intentos, cuenta el mejor. 1 punto por cada 6 filas (máx. 10). */

const policy = window.PointsPolicy;
const GAME_ID = "cita";

/* ---------- puntos UI ---------- */
const pointsEl = document.getElementById("points");
function getPoints() { return Number(localStorage.getItem("points")) || 0; }
function setPoints(v) {
  const n = Number(v) || 0;
  localStorage.setItem("points", String(n));
  if (pointsEl) pointsEl.textContent = String(n);
}
setPoints(getPoints());

/* ---------- DOM ---------- */
const canvas = document.getElementById("citaCanvas");
const ctx = canvas.getContext("2d");

const modeLabel = document.getElementById("modeLabel");
const tryLabel = document.getElementById("tryLabel");
const bestLabel = document.getElementById("bestLabel");
const rewardLabel = document.getElementById("rewardLabel");
const policyStatusEl = document.getElementById("policyStatus");
const progressFill = document.getElementById("progressFill");

const practiceBtn = document.getElementById("practiceBtn");
const challengeBtn = document.getElementById("challengeBtn");
const restartBtn = document.getElementById("restartBtn");

const overlay = document.getElementById("overlay");
const modalTitle = document.getElementById("modalTitle");
const modalText = document.getElementById("modalText");
const modalOk = document.getElementById("modalOk");
const modalAgain = document.getElementById("modalAgain");

const startOverlay = document.getElementById("startOverlay");
const startText = document.getElementById("startText");
const choosePractice = document.getElementById("choosePractice");
const chooseChallenge = document.getElementById("chooseChallenge");

/* ---------- config ---------- */
const W = 360, H = 540;            // tamaño lógico del tablero
const TILE = 40;                   // una casilla
const COLS = 9;                    // 9 × 40 = 360
const STEP = 1 / 120;              // física a paso fijo (igual en pantallas de 60 y 120 Hz)
const HOP_T = 0.12;                // lo que dura un salto (s)
const HOP_H = 11;                  // altura del salto (solo dibujo)
const HIT_HALF = 10;               // medio ancho del personaje para los choques
const VEH_PAD = 4;                 // coches y motos perdonan un poco por delante y por detrás
const LOG_TOL = 5;                 // margen al aterrizar justo en el borde de un tronco
const EDGE_OUT = 6;                // un tronco te saca si tu centro pasa de aquí
const CAM_BELOW = 3;               // filas que se ven por debajo del personaje
const AUTO0 = 0.2;                 // el camino avanza solo (filas/s) al empezar…
const AUTO_STEP = 0.006;           // …un poco más por cada fila alcanzada…
const AUTO_MAX = 0.6;              // …hasta este tope
const LATE_WARN = 1.5;             // con menos margen que esto (filas) se avisa del retraso
const RAIL_WARN = 1.15;            // s de luz roja antes de que pase el tranvía
const TRAIN_SPEED = 760;
const TRAIN_LEN = TILE * 7;
const TRIES = 3;                   // intentos del reto (cuenta el mejor)
const SCORE_DIV = 6;               // filas por punto
const MAX_SCORE = 10;
const DEAD_PAUSE = 900;            // ms tras perder antes de aceptar otro toque
const SWIPE_MIN = 22;              // px de pantalla para que un arrastre cuente como deslizar
const DIRS = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] };

const DEATHS = {
  coche: { icon: "🚗", text: "¡Cuidado con el tráfico!" },
  tren: { icon: "🚋", text: "¡Te pilló el tranvía!" },
  agua: { icon: "💦", text: "¡Al agua!" },
  corriente: { icon: "🌊", text: "Te llevó la corriente" },
  tarde: { icon: "⏰", text: "¡Llegas tarde!" }
};

/* ---------- estado ---------- */
let practiceMode = true;
let state = "idle";                // idle | ready | playing | paused | dead | between | over
let tryNo = 0;
let best = 0;                      // mejor intento de esta tanda
let score = 0;                     // fila más lejana del intento actual
let runId = 0;
let challengePending = false;      // reto elegido pero aún sin el primer movimiento
let rows = new Map();              // fila → {type, …}
let gen = null;                    // estado del generador de filas
let camRow = 0;                    // fila que queda pegada al borde de abajo (con decimales)
const player = {
  x: 0, row: 0, vRow: 0,           // x en px; fila lógica; fila "visual" (con decimales durante el salto)
  hop: null, facing: "up",
  squash: 0, bump: 0, bumpDir: [0, 0],
  dead: null, deadT: 0
};
let queued = null;                 // un movimiento pedido a mitad de salto
let particles = [];
let floaters = [];
let scorePulse = 0;
let acc = 0, lastT = 0, clock = 0;
let DPR = 1;

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function rnd(a, b) { return a + Math.random() * (b - a); }
function rint(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function mod(a, n) { return ((a % n) + n) % n; }
function colX(c) { return c * TILE + TILE / 2; }
function ptsFor(s) { return clamp(Math.floor(s / SCORE_DIV), 0, MAX_SCORE); }
function difficulty(r) { return clamp(r / 80, 0, 1); }
function autoSpeed() { return Math.min(AUTO0 + score * AUTO_STEP, AUTO_MAX); }
function isOverlayOpen() { return !!document.querySelector(".overlay:not(.hidden)"); }
function inChallenge() { return !practiceMode && !challengePending && state !== "idle" && state !== "over"; }

/* ---------- el camino: filas generadas sobre la marcha ---------- */
const OBSTACLES = ["tree", "tree", "cherry", "bush", "pot"];
const CAR_COLORS = ["#ff8da1", "#ffc65c", "#7fd1c7", "#a78bfa", "#79b8ff", "#ff9f68"];
const TRAIN_COLORS = ["#4fb3a9", "#ff8da1", "#79b8ff", "#a78bfa"];

function resetWorld() {
  rows = new Map();
  // empieza con césped: tras él, el primer tramo nunca es de césped
  gen = { next: -6, type: "grass", left: 0, segLen: 0, lane: 0, lastDir: 1, prev: null };
  camRow = -CAM_BELOW;
  ensureRows(Math.ceil(camRow + H / TILE) + 8);
}

function ensureRows(upTo) {
  while (gen.next <= upTo) {
    const row = makeRow(gen.next);
    rows.set(row.r, row);
    gen.prev = row;
    gen.next++;
  }
}
function pruneRows(below) {
  for (const r of rows.keys()) if (r < below) rows.delete(r);
}

function makeRow(r) {
  if (r < 0) return grassRow(r, { border: true });   // detrás de la salida: un seto
  if (r <= 3) return grassRow(r, { start: true });   // salida tranquila
  if (gen.left <= 0) pickSegment(r);
  gen.left--;
  if (gen.type === "road") return roadRow(r);
  if (gen.type === "river") return riverRow(r);
  if (gen.type === "rail") return railRow(r);
  return grassRow(r, {});
}

// tramos: césped (descanso), calle, río o vía; tras un tramo con peligro suele venir césped
function pickSegment(r) {
  const d = difficulty(r);
  const last = gen.type;
  let type;
  if (last !== "grass" && Math.random() < 0.7 - 0.2 * d) type = "grass";
  else {
    const opts = [];
    const add = (t, w) => { if (t !== last) opts.push([t, w]); };
    add("road", 5);
    if (r > 6) add("river", 3);
    if (r > 10) add("rail", 1.6);
    if (!opts.length) type = "grass"; // al principio, tras una calle solo queda césped
    else {
      let sum = 0;
      for (const o of opts) sum += o[1];
      let k = Math.random() * sum;
      type = opts[opts.length - 1][0];
      for (const o of opts) { k -= o[1]; if (k <= 0) { type = o[0]; break; } }
    }
  }
  let n;
  if (type === "grass") n = rint(1, d < 0.5 ? 3 : 2);
  else if (type === "road") n = rint(1, 2 + Math.round(d * 3));      // hasta 5 carriles
  else if (type === "river") n = rint(1, 2 + Math.round(d * 2));     // hasta 4 filas de agua
  else n = Math.random() < 0.25 + 0.2 * d ? 2 : 1;
  gen.type = type;
  gen.left = n;
  gen.segLen = n;
  gen.lane = 0;
}

function grassRow(r, opt) {
  const row = { r, type: "grass", blocked: new Array(COLS).fill(null), deco: [] };
  const prev = gen.prev;
  if (opt.border) {
    for (let c = 0; c < COLS; c++) row.blocked[c] = pick(["tree", "cherry", "tree", "bush"]);
  } else {
    const forbid = new Set(r === 0 ? [3, 4, 5] : opt.start ? [4] : []);
    const free = [];
    for (let c = 0; c < COLS; c++) if (!forbid.has(c)) free.push(c);
    const n = opt.start ? rint(0, 2) : rint(0, 4);
    for (let i = 0; i < n && free.length; i++) {
      const c = free.splice(Math.floor(Math.random() * free.length), 1)[0];
      row.blocked[c] = pick(OBSTACLES);
    }
    // siempre hay paso: tras otra fila de césped, al menos 2 casillas libres en las dos;
    // tras una fila de nenúfares, todos los nenúfares tienen salida
    let need = null;
    if (prev && prev.type === "grass" && prev.r >= 0) {
      const cols = [];
      for (let c = 0; c < COLS; c++) if (!prev.blocked[c]) cols.push(c);
      need = { cols, min: 2 };
    } else if (prev && prev.type === "river" && prev.lily) {
      need = { cols: prev.items.map(it => it.col), min: prev.items.length };
    }
    if (need) {
      while (need.cols.filter(c => !row.blocked[c]).length < need.min) {
        row.blocked[pick(need.cols.filter(c => row.blocked[c]))] = null;
      }
    }
    // sin callejones: cada tramo libre de la fila de césped anterior tiene salida hacia aquí
    if (prev && prev.type === "grass" && prev.r >= 0) {
      for (const seg of freeSegments(prev)) {
        if (seg.every(c => row.blocked[c])) row.blocked[pick(seg)] = null;
      }
    }
  }
  const nd = rint(2, 5);
  for (let i = 0; i < nd; i++) row.deco.push({ x: rnd(6, W - 6), y: rnd(7, TILE - 7), k: rint(0, 4) });
  return row;
}

// tramos de casillas libres seguidas de una fila de césped (entre árboles o bordes)
function freeSegments(row) {
  const segs = [];
  let cur = [];
  for (let c = 0; c < COLS; c++) {
    if (row.blocked[c]) { if (cur.length) segs.push(cur); cur = []; }
    else cur.push(c);
  }
  if (cur.length) segs.push(cur);
  return segs;
}

// sentido de un carril: casi siempre el contrario que el de al lado
function laneDir() {
  const d = (gen.lane > 0 && Math.random() < 0.75) ? -gen.lastDir : (Math.random() < 0.5 ? 1 : -1);
  gen.lastDir = d;
  gen.lane++;
  return d;
}

// objetos que dan la vuelta en bucle (coches, troncos). Con un margen M a cada
// lado mayor que el objeto más largo, el salto del bucle ocurre fuera de la pantalla.
function loopItems(M, lenFn, gapFn, extra) {
  const items = [];
  let pos = 0;
  for (;;) {
    const len = lenFn();
    items.push(Object.assign({ p: pos, len }, extra ? extra() : null));
    pos += len + gapFn();
    if (pos >= W + M) break;
  }
  return { items, loopLen: pos };
}

function roadRow(r) {
  const d = difficulty(r);
  const dir = laneDir();
  const roll = Math.random();
  const kind = roll < 0.16 + 0.12 * d ? "moto" : roll < 0.8 ? "car" : "van";
  const base = 46 + 64 * d + Math.random() * 30;
  const speed = base * (kind === "moto" ? 1.5 : kind === "van" ? 0.78 : 1);
  const len = kind === "moto" ? 30 : kind === "car" ? 50 : 84;
  // hueco mínimo: más grande cuanto más rápido va el carril (siempre da tiempo a cruzar)
  const minGap = TILE * (2.3 - 0.5 * d) + speed * 0.3;
  const maxGap = minGap + TILE * (3.4 - 1.4 * d);
  const M = 100;
  const lp = loopItems(M, () => len, () => rnd(minGap, maxGap),
    () => ({ color: pick(CAR_COLORS), heart: Math.random() < 0.3 }));
  return { r, type: "road", kind, dir, speed, M, loopLen: lp.loopLen, items: lp.items, shift: Math.random() * lp.loopLen };
}

function riverRow(r) {
  const d = difficulty(r);
  const prev = gen.prev;
  // a veces, una fila suelta de agua tiene nenúfares quietos en vez de troncos
  if (gen.segLen === 1 && prev && prev.type === "grass" && Math.random() < 0.4) {
    // un nenúfar por cada tramo libre de la orilla (así no hay callejones) y alguno más
    const cols = freeSegments(prev).map(seg => pick(seg));
    const free = [];
    for (let c = 0; c < COLS; c++) if (!prev.blocked[c] && cols.indexOf(c) === -1) free.push(c);
    const n = Math.max(cols.length, d < 0.5 ? rint(3, 5) : rint(2, 3));
    while (cols.length < n && free.length) cols.push(free.splice(Math.floor(Math.random() * free.length), 1)[0]);
    cols.sort((a, b) => a - b);
    const items = cols.map(c => ({ p: c * TILE + 3, len: TILE - 6, col: c, flower: Math.random() < 0.35, rot: rnd(0, Math.PI * 2) }));
    return { r, type: "river", lily: true, dir: 0, speed: 0, items };
  }
  const dir = laneDir();
  const speed = 34 + 42 * d + Math.random() * 22;
  const lens = d < 0.4 ? [2, 3, 3, 4] : d < 0.75 ? [2, 2, 3, 3] : [1.5, 2, 2, 3];
  const M = 170;
  const lp = loopItems(M, () => TILE * pick(lens), () => TILE * rnd(1.1 + 0.5 * d, 2.1 + 0.8 * d));
  return { r, type: "river", lily: false, dir, speed, M, loopLen: lp.loopLen, items: lp.items, shift: Math.random() * lp.loopLen };
}

function railRow(r) {
  return { r, type: "rail", dir: Math.random() < 0.5 ? 1 : -1, d: difficulty(r), timer: rnd(1.5, 5), train: null, color: pick(TRAIN_COLORS) };
}
function railInterval(row) { return rnd(3.2, 6.8) - 1.4 * row.d; }
function railWarning(row) { return !!row.train || row.timer < RAIL_WARN; }

function itemX(row, it) { return row.lily ? it.p : mod(it.p + row.shift, row.loopLen) - row.M; }

function updateRow(row, dt) {
  if (row.type === "road" || (row.type === "river" && !row.lily)) {
    row.shift = mod(row.shift + row.dir * row.speed * dt, row.loopLen);
  } else if (row.type === "rail") {
    if (row.train) {
      row.train.x += row.dir * TRAIN_SPEED * dt;
      if ((row.dir > 0 && row.train.x > W + 20) || (row.dir < 0 && row.train.x + TRAIN_LEN < -20)) {
        row.train = null;
        row.timer = railInterval(row);
        row.color = pick(TRAIN_COLORS);
      }
    } else {
      row.timer -= dt;
      if (row.timer <= 0) row.train = { x: row.dir > 0 ? -TRAIN_LEN - 10 : W + 10 };
    }
  }
}

function platformAt(row, x) {
  for (const it of row.items) {
    const ix = itemX(row, it);
    if (x >= ix - LOG_TOL && x <= ix + it.len + LOG_TOL) return it;
  }
  return null;
}
function hitsVehicle(row) {
  for (const it of row.items) {
    const x = itemX(row, it);
    if (player.x + HIT_HALF > x + VEH_PAD && player.x - HIT_HALF < x + it.len - VEH_PAD) return true;
  }
  return false;
}
function hitsTrain(row) {
  const t = row.train;
  return !!t && player.x + HIT_HALF > t.x && player.x - HIT_HALF < t.x + TRAIN_LEN;
}

/* ---------- modales ---------- */
function openModal(t, x) {
  modalTitle.textContent = t;
  modalText.textContent = x;
  // tras un reto (ya gastado) "Jugar otra" lleva a la práctica
  modalAgain.textContent = practiceMode ? "Jugar otra" : "Practicar";
  overlay.classList.remove("hidden");
}
function closeModal() { overlay.classList.add("hidden"); }
modalOk.onclick = closeModal;
modalAgain.onclick = () => { closeModal(); restartSameMode(); };

function updatePolicyStatus() {
  if (!policyStatusEl || !policy?.getWeekendRewardStatusText) return;
  policyStatusEl.textContent = policy.getWeekendRewardStatusText(GAME_ID);
}

function openStartModal() {
  const st = policy?.canPlayWeekendChallenge ? policy.canPlayWeekendChallenge(GAME_ID) : { ok: true, reason: "" };
  chooseChallenge.disabled = !st.ok;
  chooseChallenge.title = st.ok ? "" : st.reason;
  startText.textContent = st.ok
    ? "Elige modo. En Reto tienes 3 intentos y cuenta el mejor: 1 punto por cada 6 filas. 1 vez por fin de semana. Si sales a mitad, pierdes los intentos que te queden."
    : st.reason + " Puedes practicar igualmente.";
  startOverlay.classList.remove("hidden");
}
function closeStartModal() { startOverlay.classList.add("hidden"); }
choosePractice.onclick = () => { closeStartModal(); startPractice(); };
chooseChallenge.onclick = () => { if (chooseChallenge.disabled) return; closeStartModal(); startChallenge(); };

/* ---------- UI ---------- */
function setModeUI() {
  if (policy?.canPlayWeekendChallenge) {
    const st = policy.canPlayWeekendChallenge(GAME_ID);
    challengeBtn.disabled = !st.ok;
    challengeBtn.title = st.ok ? "" : st.reason;
  }
  updatePolicyStatus();
  updateHUD();
}
function updateHUD() {
  const idle = state === "idle";
  modeLabel.textContent = idle ? "—" : (practiceMode ? "Práctica" : "Reto (+ puntos)");
  tryLabel.textContent = idle ? "—" : (practiceMode ? "∞" : Math.min(tryNo, TRIES) + "/" + TRIES);
  const shown = Math.max(best, state === "playing" || state === "paused" ? score : 0);
  bestLabel.textContent = String(shown);
  rewardLabel.textContent = (idle || practiceMode) ? "—" : "+" + ptsFor(shown);
  progressFill.style.width = (clamp(shown / (SCORE_DIV * MAX_SCORE), 0, 1) * 100) + "%";
}

/* ---------- partida ---------- */
function placePlayerStart() {
  player.x = colX(4);
  player.row = 0;
  player.vRow = 0;
  player.hop = null;
  player.facing = "up";
  player.squash = 0;
  player.bump = 0;
  player.dead = null;
  player.deadT = 0;
  queued = null;
}

function enterReady() {
  runId++;
  state = "ready";
  score = 0;
  resetWorld();
  placePlayerStart();
  particles = [];
  floaters = [];
  acc = 0;
  ptr = null;
  canvas.classList.add("is-playing"); // deslizar el dedo ya mueve al personaje
  updateHUD();
}

function bump(dc, dr) {
  player.bump = 1;
  player.bumpDir = [dc, dr];
}

function tryMove(dir) {
  const [dc, dr] = DIRS[dir];
  player.facing = dir;
  const cur = rows.get(player.row);
  const tr = player.row + dr;
  ensureRows(tr + 16);
  const target = rows.get(tr);
  if (!target) { bump(dc, dr); return; }
  let tx = player.x + dc * TILE;
  if (target.type === "river") {
    // en el agua la x es libre (vas sobre troncos); de lado no se sale de la pantalla
    if (dc !== 0 && (tx < TILE / 2 - 1 || tx > W - TILE / 2 + 1)) { bump(dc, dr); return; }
    if (target.lily) {
      // salta al nenúfar más cercano si está a tiro (si no, al agua)
      let near = null, bd = TILE * 0.6;
      for (const it of target.items) {
        const dd = Math.abs(it.p + it.len / 2 - tx);
        if (dd < bd) { bd = dd; near = it; }
      }
      if (near) tx = near.p + near.len / 2;
    }
  } else {
    // en tierra firme se va por casillas
    let c = Math.round((tx - TILE / 2) / TILE);
    if (dc !== 0 && (c < 0 || c >= COLS)) { bump(dc, dr); return; }
    c = clamp(c, 0, COLS - 1);
    if (target.type === "grass" && target.blocked[c]) {
      // al bajar de un tronco puedes caer en la casilla de al lado si está libre
      const alt = tx > colX(c) ? c + 1 : c - 1;
      if (dr !== 0 && cur && cur.type === "river" && alt >= 0 && alt < COLS &&
          !target.blocked[alt] && Math.abs(colX(alt) - tx) < TILE * 0.85) c = alt;
      else { bump(dc, dr); return; }
    }
    tx = colX(c);
  }
  player.hop = { fromX: player.x, toX: tx, fromRow: player.row, t: 0 };
  player.row = tr;
}

function land() {
  const h = player.hop;
  player.hop = null;
  player.x = h.toX;
  player.vRow = player.row;
  player.squash = 1;
  const row = rows.get(player.row);
  if (row && row.type === "river") {
    const it = platformAt(row, player.x);
    if (!it) { die("agua"); return; }
    if (row.lily) player.x = it.p + it.len / 2;
  }
  if (player.row > score) {
    const before = ptsFor(score);
    score = player.row;
    scorePulse = 1;
    if (!practiceMode && ptsFor(score) > before) floatText(ptsFor(score) >= MAX_SCORE ? "🌹 ¡Máximo!" : "+1 ⭐");
    updateHUD();
  }
}

function physics(dt) {
  for (const row of rows.values()) updateRow(row, dt);

  if (player.hop) {
    const h = player.hop;
    h.t += dt / HOP_T;
    const k = Math.min(1, h.t);
    player.x = h.fromX + (h.toX - h.fromX) * k;
    player.vRow = h.fromRow + (player.row - h.fromRow) * k;
    if (h.t >= 1) { land(); if (state !== "playing") return; }
  } else if (queued) {
    const q = queued;
    queued = null;
    tryMove(q);
  }

  const row = rows.get(player.row);
  // sobre un tronco, te lleva la corriente
  if (!player.hop && row && row.type === "river" && !row.lily) {
    player.x += row.dir * row.speed * dt;
    if (player.x < EDGE_OUT || player.x > W - EDGE_OUT) { die("corriente"); return; }
  }
  if (row && row.type === "road" && hitsVehicle(row)) { die("coche"); return; }
  if (row && row.type === "rail" && hitsTrain(row)) { die("tren"); return; }

  // cámara: sigue al personaje y además avanza sola (no da marcha atrás)
  const target = player.vRow - CAM_BELOW;
  if (target > camRow) camRow += (target - camRow) * Math.min(1, dt * 6);
  camRow += autoSpeed() * dt;
  if (player.vRow + 0.5 < camRow) { die("tarde"); return; }

  ensureRows(Math.ceil(camRow + H / TILE) + 6);
  pruneRows(Math.floor(camRow) - 4);
}

function die(kind) {
  state = "dead";
  player.dead = kind;
  player.deadT = 0;
  player.hop = null;
  queued = null;
  const id = runId;
  canvas.classList.remove("shake");
  void canvas.offsetWidth; // reinicia la animación
  canvas.classList.add("shake");
  try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) { /* sin vibración */ }
  const y = -(player.vRow + 0.5) * TILE;
  if (kind === "agua" || kind === "corriente") splash(player.x, y);
  else if (kind === "tarde") floaters.push({ x: clamp(player.x, 70, W - 70), y: -(camRow + 1.3) * TILE, text: "⏰ ¡Tarde!", life: 1 });
  else petals(player.x, y);
  best = Math.max(best, score);
  updateHUD();
  setTimeout(() => {
    if (state !== "dead" || id !== runId) return; // se reinició entretanto
    if (!practiceMode && tryNo >= TRIES) { state = "over"; finish(); }
    else state = "between";
  }, DEAD_PAUSE);
}

function finish() {
  canvas.classList.remove("is-playing");
  const pts = ptsFor(best);
  const unit = best === 1 ? "fila" : "filas";
  if (pts <= 0) {
    openModal("🏁 Fin del reto", `Mejor intento: ${best} ${unit}.\n\nHacen falta ${SCORE_DIV} para puntuar: 0 puntos.`);
  } else {
    const res = policy?.awardWeekendChallengePoints
      ? policy.awardWeekendChallengePoints(pts, GAME_ID)
      : { ok: false, reason: "No se pudo aplicar la política.", gained: 0 };
    if (res.ok) {
      openModal("🌹 ¡Llegaste a la cita!", `Mejor intento: ${best} ${unit}\n\nPuntos: +${res.gained}`);
      if (window.PiviCore) PiviCore.celebrate();
    } else {
      openModal("🏁 Fin del reto", `Mejor intento: ${best} ${unit}\n\nNo puntúa: ${res.reason}`);
    }
  }
  updatePolicyStatus();
  updateHUD();
}

// dir: "up" | "down" | "left" | "right", o null si solo es un toque para seguir
function handleInput(dir) {
  if (isOverlayOpen()) return;
  switch (state) {
    case "ready":
      if (!practiceMode && challengePending) {
        const st = policy?.canPlayWeekendChallenge ? policy.canPlayWeekendChallenge(GAME_ID) : { ok: true, reason: "" };
        if (!st.ok) {
          state = "over";
          challengePending = false;
          canvas.classList.remove("is-playing");
          openModal("⛔ No disponible", st.reason);
          return;
        }
        policy?.markWeekendChallengePlayed?.(GAME_ID);
        challengePending = false;
        updatePolicyStatus();
      }
      state = "playing";
      acc = 0;
      updateHUD();
      if (dir) tryMove(dir);
      break;
    case "playing":
      if (!dir) return;
      if (player.hop) queued = dir; // se hace al aterrizar: no se pierde ningún toque
      else tryMove(dir);
      break;
    case "paused":
      state = "playing";
      acc = 0;
      break;
    case "between":
      if (!practiceMode) tryNo++;
      enterReady();
      break;
    case "idle":
    case "over":
      openStartModal();
      break;
  }
}

/* ---------- efectos ---------- */
// pétalos de la rosa al chocar
function petals(x, y) {
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2, sp = 80 + Math.random() * 170;
    particles.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, g: 650,
      life: 1, decay: 1 / 0.9, size: 2.6 + Math.random() * 2.6,
      kind: i % 4 === 0 ? "heart" : "petal",
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 10
    });
  }
}
function splash(x, y) {
  particles.push({ x, y, vx: 0, vy: 0, g: 0, life: 1, decay: 1 / 0.7, size: 6, kind: "ring", rot: 0, vr: 0 });
  particles.push({ x, y, vx: 0, vy: 0, g: 0, life: 1.25, decay: 1 / 0.9, size: 3, kind: "ring", rot: 0, vr: 0 });
  for (let i = 0; i < 12; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, sp = 90 + Math.random() * 120;
    particles.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 700,
      life: 1, decay: 1 / 0.6, size: 1.8 + Math.random() * 2, kind: "drop", rot: 0, vr: 0
    });
  }
}
function floatText(text) {
  floaters.push({ x: player.x, y: -(player.row + 0.5) * TILE - 24, text, life: 1 });
}
function updateParticles(dt) {
  for (const p of particles) {
    p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    p.life -= dt * p.decay;
    if (p.kind === "ring") p.size += dt * 38;
  }
  particles = particles.filter(p => p.life > 0);
  for (const f of floaters) { f.y -= dt * 34; f.life -= dt / 1.1; }
  floaters = floaters.filter(f => f.life > 0);
}

/* ---------- bucle ---------- */
function update(dt) {
  clock += dt;
  if (state === "paused") return; // en pausa todo quieto
  scorePulse = Math.max(0, scorePulse - dt / 0.25);
  player.squash = Math.max(0, player.squash - dt / 0.15);
  player.bump = Math.max(0, player.bump - dt / 0.18);
  if (player.dead) player.deadT += dt;
  updateParticles(dt);
  if (state === "playing") {
    acc += dt;
    while (acc >= STEP && state === "playing") { physics(STEP); acc -= STEP; }
    return;
  }
  // esperando (o tras perder): el tráfico sigue, pero el camino no avanza
  for (const row of rows.values()) updateRow(row, dt);
}

function frame(t) {
  const dt = Math.min((t - (lastT || t)) / 1000, 0.05);
  lastT = t;
  if (!isOverlayOpen()) update(dt); // con una ventana abierta, el juego se congela
  draw();
  requestAnimationFrame(frame);
}

/* ---------- dibujo ---------- */
let C = {};
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = n => cs.getPropertyValue(n).trim();
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  C = {
    dark,
    text: v("--text"), soft: v("--text-soft"), surface: v("--surface"),
    p1: v("--primary"), p2: v("--primary-strong"),
    grassA: dark ? "#2d4a35" : "#c6e9a6",
    grassB: dark ? "#29442f" : "#badf98",
    flowers: dark ? ["#d98aa0", "#d9cf8a", "#cfc6e6", "#e0a3b4"] : ["#ff9fb0", "#ffe27a", "#ffffff", "#c9b6ff"],
    tuft: dark ? "rgba(255,255,255,.09)" : "rgba(70,140,60,.35)",
    shadow: dark ? "rgba(0,0,0,.32)" : "rgba(40,70,30,.2)",
    tree: dark ? "#3f7d4a" : "#7cc77e", treeDark: dark ? "#2f6139" : "#5aa960", treeLight: dark ? "#529160" : "#a3dca1",
    cherry: dark ? "#b46681" : "#ffb7c9", cherryDark: dark ? "#94506a" : "#f492ad", cherryLight: dark ? "#cf86a0" : "#ffd9e3",
    trunk: dark ? "#6b4a35" : "#9a6a48",
    bush: dark ? "#3a7444" : "#6cbf72", bushDark: dark ? "#2d5e37" : "#55a95c",
    pot: dark ? "#a3624a" : "#e2895f", potDark: dark ? "#83503c" : "#c56f48",
    road: dark ? "#3b3a47" : "#8f91a0",
    lane: dark ? "rgba(255,255,255,.33)" : "rgba(255,255,255,.8)",
    curb: dark ? "#57525e" : "#ece6df",
    water: dark ? "#24506b" : "#92d7f2",
    wave: dark ? "rgba(255,255,255,.13)" : "rgba(255,255,255,.6)",
    foam: dark ? "rgba(255,255,255,.18)" : "rgba(255,255,255,.7)",
    log: dark ? "#7c573a" : "#b98257", logTop: dark ? "#8f6747" : "#d09c6e", logEnd: dark ? "#a98163" : "#efc79a",
    lily: dark ? "#3d7b48" : "#5dbb6a", lilyLight: dark ? "#4f9159" : "#86d18f",
    bed: dark ? "#4a4141" : "#dcc9ad",
    sleeper: dark ? "#6b5242" : "#a7825e",
    railC: dark ? "#a0a6b3" : "#7a8090",
    post: dark ? "#2b2730" : "#4a4552",
    glass: dark ? "#2a3550" : "#e3f5ff",
    wheel: "#2b2730",
    head: "#fff3a6",
    tail: "#ff6b6b",
    belly: dark ? "#ffd3dc" : "#ffe3e9",
    eye: "#3b2a30",
    blush: dark ? "rgba(200,40,75,.45)" : "rgba(215,45,80,.35)",
    rose: "#e8344e", roseDark: "#a8192f", stem: "#3e9a4c",
    drop: dark ? "#9fd8f0" : "#ffffff"
  };
}

function setupCanvas() {
  DPR = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function heartPath(s) {
  ctx.beginPath();
  ctx.moveTo(0, s * 0.95);
  ctx.bezierCurveTo(-s * 1.7, -s * 0.05, -s * 0.95, -s * 1.35, 0, -s * 0.5);
  ctx.bezierCurveTo(s * 0.95, -s * 1.35, s * 1.7, -s * 0.05, 0, s * 0.95);
  ctx.closePath();
}

function roundRectPath(x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
function ellipse(x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2); ctx.fill(); }

/* suelo de cada fila (y = borde de arriba de la fila) */
function drawRowBase(row, y) {
  const above = rows.get(row.r + 1), below = rows.get(row.r - 1);
  if (row.type === "grass") {
    ctx.fillStyle = (row.r & 1) ? C.grassA : C.grassB;
    ctx.fillRect(0, y, W, TILE);
    for (const d of row.deco) {
      if (d.k === 4) { // matita
        ctx.strokeStyle = C.tuft;
        ctx.lineWidth = 1.6;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(d.x - 3, y + d.y + 3); ctx.lineTo(d.x - 4, y + d.y - 2);
        ctx.moveTo(d.x, y + d.y + 3); ctx.lineTo(d.x, y + d.y - 4);
        ctx.moveTo(d.x + 3, y + d.y + 3); ctx.lineTo(d.x + 4, y + d.y - 2);
        ctx.stroke();
      } else { // florecita
        ctx.fillStyle = C.flowers[d.k];
        for (let i = 0; i < 4; i++) circle(d.x + Math.cos(i * Math.PI / 2) * 2.2, y + d.y + Math.sin(i * Math.PI / 2) * 2.2, 1.7);
        ctx.fillStyle = "#ffd25c";
        circle(d.x, y + d.y, 1.2);
      }
    }
  } else if (row.type === "road") {
    ctx.fillStyle = C.road;
    ctx.fillRect(0, y, W, TILE);
    if (above && above.type === "road") { // raya discontinua entre carriles
      ctx.fillStyle = C.lane;
      for (let x = 8; x < W; x += 40) ctx.fillRect(x, y - 1.5, 20, 3);
    } else {
      ctx.fillStyle = C.curb;
      ctx.fillRect(0, y, W, 4);
    }
    if (!below || below.type !== "road") {
      ctx.fillStyle = C.curb;
      ctx.fillRect(0, y + TILE - 4, W, 4);
    }
  } else if (row.type === "river") {
    ctx.fillStyle = C.water;
    ctx.fillRect(0, y, W, TILE);
    // ondas que se mueven con la corriente
    ctx.strokeStyle = C.wave;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    const drift = (row.lily ? 8 : row.speed * 0.55) * (row.dir || 1) * clock;
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const wx = mod(k * 101 + row.r * 37 + drift, W + 40) - 20;
      const wy = y + 9 + mod(k * 13 + row.r * 7, 22);
      ctx.moveTo(wx, wy);
      ctx.quadraticCurveTo(wx + 6, wy - 4, wx + 12, wy);
    }
    ctx.stroke();
    ctx.fillStyle = C.foam;
    if (!above || above.type !== "river") ctx.fillRect(0, y, W, 3);
    if (!below || below.type !== "river") ctx.fillRect(0, y + TILE - 3, W, 3);
    // troncos y nenúfares van a ras del agua
    for (const it of row.items) {
      const x = itemX(row, it);
      if (x > W + 4 || x + it.len < -4) continue;
      if (row.lily) drawLily(it, y); else drawLog(it, x, y);
    }
  } else if (row.type === "rail") {
    ctx.fillStyle = C.bed;
    ctx.fillRect(0, y, W, TILE);
    ctx.fillStyle = C.sleeper;
    for (let x = 4; x < W; x += 20) ctx.fillRect(x, y + 6, 8, TILE - 12);
    ctx.fillStyle = C.railC;
    ctx.fillRect(0, y + 11, W, 3);
    ctx.fillRect(0, y + TILE - 14, W, 3);
    if (railWarning(row) && Math.sin(clock * 18) > 0) {
      ctx.fillStyle = "rgba(255,70,90,.16)";
      ctx.fillRect(0, y, W, TILE);
    }
  }
}

/* lo que sobresale del suelo (árboles, coches, tranvía…) */
function drawRowObjects(row, y) {
  if (row.type === "grass") {
    for (let c = 0; c < COLS; c++) if (row.blocked[c]) drawObstacle(row.blocked[c], colX(c), y + TILE / 2);
  } else if (row.type === "road") {
    for (const it of row.items) {
      const x = itemX(row, it);
      if (x > W + 50 || x + it.len < -50) continue;
      drawVehicle(row, it, x, y);
    }
  } else if (row.type === "rail") {
    if (row.train) drawTrain(row, y);
    drawSignal(row, y);
  }
}

function drawObstacle(kind, cx, cy) {
  ctx.fillStyle = C.shadow;
  ellipse(cx + 3, cy + 10, 15, 6);
  if (kind === "tree" || kind === "cherry") {
    const base = kind === "tree" ? C.tree : C.cherry;
    const dark = kind === "tree" ? C.treeDark : C.cherryDark;
    const light = kind === "tree" ? C.treeLight : C.cherryLight;
    ctx.fillStyle = C.trunk;
    ctx.fillRect(cx - 3, cy + 1, 6, 10);
    ctx.fillStyle = dark;
    circle(cx, cy - 4, 17);
    ctx.fillStyle = base;
    circle(cx - 1, cy - 6, 15);
    circle(cx - 8, cy - 2, 9);
    circle(cx + 8, cy - 3, 9);
    ctx.fillStyle = light;
    circle(cx - 5, cy - 11, 6);
    if (kind === "cherry") { // flores del cerezo
      ctx.fillStyle = "#ffffff";
      circle(cx + 6, cy - 10, 1.8); circle(cx - 9, cy - 1, 1.6); circle(cx + 2, cy + 2, 1.6); circle(cx + 10, cy - 2, 1.4);
    }
  } else if (kind === "bush") {
    ctx.fillStyle = C.bushDark;
    circle(cx - 7, cy + 1, 10); circle(cx + 7, cy + 1, 10); circle(cx, cy - 5, 11);
    ctx.fillStyle = C.bush;
    circle(cx - 7, cy - 1, 8); circle(cx + 7, cy - 1, 8); circle(cx, cy - 7, 9);
    ctx.fillStyle = C.flowers[0];
    circle(cx - 4, cy - 8, 2); circle(cx + 6, cy - 3, 2); circle(cx - 8, cy + 1, 1.8);
  } else if (kind === "pot") {
    // flores primero (asoman por arriba), luego la maceta
    ctx.fillStyle = C.bushDark;
    circle(cx, cy - 7, 9);
    const fc = [C.flowers[0], "#ff6f8a", C.flowers[1]];
    [[-5, -10], [5, -11], [0, -4]].forEach(([dx, dy], i) => {
      ctx.fillStyle = fc[i];
      circle(cx + dx, cy + dy, 4.2);
      ctx.fillStyle = "#ffd25c";
      circle(cx + dx, cy + dy, 1.5);
    });
    ctx.fillStyle = C.pot;
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy - 1); ctx.lineTo(cx + 10, cy - 1); ctx.lineTo(cx + 7, cy + 12); ctx.lineTo(cx - 7, cy + 12);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = C.potDark;
    ctx.fillRect(cx - 11, cy - 3, 22, 5);
  }
}

function drawVehicle(row, it, x, y) {
  const cy = y + TILE / 2;
  const len = it.len;
  const fwd = row.dir > 0;
  const front = fwd ? x + len : x;
  const s = fwd ? 1 : -1; // hacia dónde mira
  if (C.dark) { // faros encendidos de noche
    ctx.fillStyle = "rgba(255,222,120,.16)";
    ctx.beginPath();
    ctx.moveTo(front, cy - 6); ctx.lineTo(front + s * 46, cy - 16); ctx.lineTo(front + s * 46, cy + 16); ctx.lineTo(front, cy + 6);
    ctx.closePath();
    ctx.fill();
  }
  if (row.kind === "moto") {
    ctx.fillStyle = C.shadow;
    roundRectPath(x + 2, cy - 4, len, 12, 6); ctx.fill();
    ctx.fillStyle = C.wheel;
    roundRectPath(x, cy - 3, 9, 6, 3); ctx.fill();
    roundRectPath(x + len - 9, cy - 3, 9, 6, 3); ctx.fill();
    ctx.fillStyle = it.color;
    roundRectPath(x + 5, cy - 6, len - 10, 12, 6); ctx.fill();
    ctx.fillStyle = "#ffffff"; // casco
    circle(x + len / 2 - s * 2, cy, 5.5);
    ctx.fillStyle = C.glass;
    circle(x + len / 2 + s * 1, cy, 2.6);
    ctx.fillStyle = C.head;
    circle(front - s * 2, cy, 2.2);
    return;
  }
  const h = row.kind === "van" ? 30 : 26;
  const top = cy - h / 2;
  ctx.fillStyle = C.shadow;
  roundRectPath(x + 3, top + 4, len, h, 8); ctx.fill();
  // ruedas que asoman por los lados
  ctx.fillStyle = C.wheel;
  for (const wx of [x + 7, x + len - 16]) {
    ctx.fillRect(wx, top - 2, 9, 4);
    ctx.fillRect(wx, top + h - 2, 9, 4);
  }
  ctx.fillStyle = it.color;
  roundRectPath(x, top, len, h, 8); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.28)"; // brillo del techo
  roundRectPath(x + 4, top + 3, len - 8, 5, 3); ctx.fill();
  ctx.fillStyle = C.glass;
  if (row.kind === "van") {
    roundRectPath(fwd ? x + len - 15 : x + 6, top + 4, 9, h - 8, 3); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,.08)"; // caja
    roundRectPath(fwd ? x + 6 : x + 19, top + 5, len - 25, h - 10, 4); ctx.fill();
  } else {
    roundRectPath(fwd ? x + len - 17 : x + 9, top + 4, 8, h - 8, 3); ctx.fill();   // parabrisas
    roundRectPath(fwd ? x + 7 : x + len - 12, top + 5, 5, h - 10, 2); ctx.fill();  // luna de atrás
  }
  if (it.heart) {
    ctx.save();
    ctx.translate(x + len / 2 - s * 3, cy + 1);
    ctx.fillStyle = "rgba(255,255,255,.85)";
    heartPath(4);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = C.head;
  circle(front - s * 2.5, top + 5, 2.4);
  circle(front - s * 2.5, top + h - 5, 2.4);
  ctx.fillStyle = C.tail;
  const back = fwd ? x : x + len;
  circle(back + s * 2, top + 5, 1.9);
  circle(back + s * 2, top + h - 5, 1.9);
}

function drawLog(it, x, y) {
  const h = 26, top = y + (TILE - h) / 2;
  ctx.fillStyle = "rgba(0,0,0,.12)";
  roundRectPath(x + 2, top + 4, it.len, h, 11); ctx.fill();
  ctx.fillStyle = C.log;
  roundRectPath(x, top, it.len, h, 11); ctx.fill();
  ctx.fillStyle = C.logTop;
  roundRectPath(x + 6, top + 3, it.len - 12, 7, 3.5); ctx.fill();
  // vetas de la corteza
  ctx.strokeStyle = "rgba(0,0,0,.14)";
  ctx.lineWidth = 1.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let k = x + 16; k < x + it.len - 16; k += 26) {
    ctx.moveTo(k, top + 15); ctx.lineTo(k + 10, top + 15);
    ctx.moveTo(k + 8, top + 20); ctx.lineTo(k + 15, top + 20);
  }
  ctx.stroke();
  // anillos en los extremos
  for (const ex of [x + 6, x + it.len - 6]) {
    ctx.fillStyle = C.logEnd;
    ellipse(ex, top + h / 2, 4.5, h / 2 - 3);
    ctx.strokeStyle = C.log;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(ex, top + h / 2, 2, h / 2 - 7, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawLily(it, y) {
  const cx = it.p + it.len / 2, cy = y + TILE / 2;
  ctx.fillStyle = "rgba(0,0,0,.1)";
  ellipse(cx + 2, cy + 3, 15, 14);
  ctx.fillStyle = C.lily;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, 15, it.rot + 0.32, it.rot + Math.PI * 2 - 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = C.lilyLight;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let k = 1; k < 5; k++) {
    const a = it.rot + 0.32 + k * 1.2;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * 11, cy + Math.sin(a) * 11);
  }
  ctx.stroke();
  if (it.flower) {
    const fx = cx + Math.cos(it.rot + 3) * 6, fy = cy + Math.sin(it.rot + 3) * 6;
    ctx.fillStyle = C.flowers[0];
    for (let i = 0; i < 5; i++) circle(fx + Math.cos(i * 1.257) * 3, fy + Math.sin(i * 1.257) * 3, 2.4);
    ctx.fillStyle = "#ffd25c";
    circle(fx, fy, 1.6);
  }
}

function drawTrain(row, y) {
  const x = row.train.x, len = TRAIN_LEN, h = 32, top = y + (TILE - h) / 2;
  const fwd = row.dir > 0;
  ctx.fillStyle = C.shadow;
  roundRectPath(x + 3, top + 5, len, h, 10); ctx.fill();
  ctx.fillStyle = row.color;
  roundRectPath(x, top, len, h, 10); ctx.fill();
  // vagones
  ctx.fillStyle = "rgba(0,0,0,.18)";
  for (let k = 1; k < 3; k++) ctx.fillRect(x + (len * k) / 3 - 1.5, top, 3, h);
  // franja blanca con corazoncitos
  ctx.fillStyle = "rgba(255,255,255,.75)";
  ctx.fillRect(x + 10, top + h / 2 - 3, len - 20, 6);
  ctx.fillStyle = row.color;
  for (let k = x + 30; k < x + len - 20; k += 46) {
    ctx.save();
    ctx.translate(k, top + h / 2);
    heartPath(2.6);
    ctx.fill();
    ctx.restore();
  }
  // morro
  const front = fwd ? x + len : x;
  ctx.fillStyle = C.glass;
  roundRectPath(fwd ? front - 14 : front + 6, top + 4, 8, h - 8, 3); ctx.fill();
  ctx.fillStyle = C.head;
  circle(fwd ? front - 3 : front + 3, top + 7, 2.4);
  circle(fwd ? front - 3 : front + 3, top + h - 7, 2.4);
}

// semáforo del tranvía, en el lado por el que viene
function drawSignal(row, y) {
  const x = row.dir > 0 ? 12 : W - 12, cy = y + 7;
  ctx.fillStyle = C.post;
  ctx.fillRect(x - 1.5, cy, 3, 12);
  roundRectPath(x - 6, cy - 6, 12, 12, 4); ctx.fill();
  const on = railWarning(row) && Math.sin(clock * 18) > 0;
  ctx.fillStyle = on ? "#ff4d5e" : "#6b6470";
  circle(x, cy, 3.6);
  if (on) {
    ctx.fillStyle = "rgba(255,77,94,.3)";
    circle(x, cy, 8);
  }
}

function drawPlayer() {
  const cx = player.x;
  const cy = -(player.vRow + 0.5) * TILE;
  const lift = player.hop ? Math.sin(Math.min(1, player.hop.t) * Math.PI) * HOP_H : 0;
  const dead = player.dead;
  if (dead === "tarde" && state !== "playing") return; // se quedó atrás, fuera de la vista

  ctx.save();
  if (dead === "agua" || dead === "corriente") { // se hunde
    const k = clamp(1 - player.deadT * 1.8, 0, 1);
    if (k <= 0) { ctx.restore(); return; }
    ctx.globalAlpha = k;
    ctx.translate(cx, cy + (1 - k) * 4);
    ctx.scale(k, k);
  } else if (dead === "coche" || dead === "tren") { // aplastado
    ctx.fillStyle = C.shadow;
    ellipse(cx, cy + 6, 20, 6);
    ctx.translate(cx, cy + 5);
    ctx.scale(1.55, 0.38);
  } else {
    ctx.fillStyle = C.shadow;
    ellipse(cx, cy + 10, 11 - lift * 0.3, 4.5 - lift * 0.12);
    const b = Math.sin(player.bump * Math.PI) * 3.5; // choque suave contra un árbol
    ctx.translate(cx + player.bumpDir[0] * b, cy - 3 - lift - player.bumpDir[1] * b);
    const sq = player.squash;
    ctx.scale(1 + 0.12 * sq, 1 - 0.12 * sq);
  }

  const [fdx, fdy] = DIRS[player.facing];
  const fx = fdx * 2.6, fy = -fdy * 2.2;
  const side = player.facing === "left" ? -1 : 1;
  // pies
  ctx.fillStyle = C.p2;
  ellipse(-5, 11.5, 4, 2.6);
  ellipse(5, 11.5, 4, 2.6);
  // rosa (detrás si mira hacia arriba)
  const rose = () => {
    if (dead === "coche" || dead === "tren") return;
    ctx.strokeStyle = C.stem;
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(side * 9, 6); ctx.lineTo(side * 13, -5);
    ctx.stroke();
    ctx.fillStyle = C.stem;
    ellipse(side * 11.5, 1, 2.6, 1.4);
    ctx.fillStyle = C.rose;
    circle(side * 13.5, -7, 4.6);
    ctx.strokeStyle = C.roseDark;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(side * 13.5, -7, 2.2, 0.3, Math.PI * 1.6);
    ctx.stroke();
  };
  if (player.facing === "up") rose();
  // cuerpo
  ctx.fillStyle = C.p1;
  circle(0, 0, 13);
  ctx.strokeStyle = C.p2;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = C.belly;
  ellipse(fx * 0.5, 4 + fy * 0.4, 8, 6.5);
  // tupé
  ctx.strokeStyle = C.p2;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-1, -12.5);
  ctx.quadraticCurveTo(2, -18, 5, -15);
  ctx.stroke();
  // cara (mira hacia donde va)
  if (dead === "coche" || dead === "tren") {
    ctx.strokeStyle = C.eye;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const ex of [-4.5, 4.5]) { // ojos en X
      ctx.moveTo(ex - 2, -5); ctx.lineTo(ex + 2, -1);
      ctx.moveTo(ex + 2, -5); ctx.lineTo(ex - 2, -1);
    }
    ctx.stroke();
  } else {
    ctx.fillStyle = C.blush;
    ellipse(-8 + fx, 1.5 + fy, 2.8, 1.8);
    ellipse(8 + fx, 1.5 + fy, 2.8, 1.8);
    ctx.fillStyle = C.eye;
    circle(-4.5 + fx, -3 + fy, 2.3);
    circle(4.5 + fx, -3 + fy, 2.3);
    ctx.fillStyle = "#ffffff";
    circle(-3.8 + fx, -3.8 + fy, 0.8);
    circle(5.2 + fx, -3.8 + fy, 0.8);
    ctx.strokeStyle = C.eye;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(fx, 0.5 + fy, 2.4, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();
  }
  if (player.facing !== "up") rose();
  ctx.restore();
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = clamp(p.life, 0, 1);
    if (p.kind === "ring") {
      ctx.strokeStyle = C.drop;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.size * 1.4, p.size * 0.7, 0, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    if (p.kind === "heart") {
      ctx.fillStyle = C.p1;
      heartPath(p.size * 1.2);
      ctx.fill();
    } else if (p.kind === "petal") {
      ctx.fillStyle = C.rose;
      ellipse(0, 0, p.size, p.size * 0.6);
    } else {
      ctx.fillStyle = C.drop;
      circle(0, 0, p.size);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawFloaters() {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = '800 18px "Baloo 2", system-ui, sans-serif';
  ctx.lineJoin = "round";
  ctx.lineWidth = 5;
  for (const f of floaters) {
    ctx.globalAlpha = clamp(f.life * 1.6, 0, 1);
    ctx.strokeStyle = C.surface;
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = C.text;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.restore();
}

// aviso de "¡que llegas tarde!" cuando el borde de abajo te alcanza
function drawLateWarning() {
  if (state !== "playing") return;
  const margin = player.vRow + 0.5 - camRow;
  if (margin >= LATE_WARN) return;
  const k = clamp(1 - margin / LATE_WARN, 0, 1);
  const a = k * (0.45 + 0.2 * Math.sin(clock * 12));
  const g = ctx.createLinearGradient(0, H - 90, 0, H);
  g.addColorStop(0, "rgba(255,77,94,0)");
  g.addColorStop(1, `rgba(255,77,94,${a.toFixed(3)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, H - 90, W, 90);
  ctx.globalAlpha = clamp(k * 1.5, 0, 1);
  ctx.font = '26px system-ui, sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("⏰", W - 26, H - 26);
  ctx.globalAlpha = 1;
}

function drawScore() {
  if (state === "idle") return;
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const size = Math.round(40 * (1 + 0.16 * scorePulse));
  ctx.font = `800 ${size}px "Baloo 2", system-ui, sans-serif`;
  ctx.lineJoin = "round";
  ctx.lineWidth = 7;
  ctx.strokeStyle = C.surface;
  ctx.strokeText(String(score), 16, 34);
  ctx.fillStyle = C.text;
  ctx.fillText(String(score), 16, 34);
  ctx.restore();
}

function drawMessage() {
  let l1 = "", l2 = "";
  const unit = n => (n === 1 ? "fila" : "filas");
  if (state === "idle") { l1 = "Elige un modo"; l2 = "para empezar"; }
  else if (state === "ready") {
    l1 = "👆 Toca para avanzar";
    l2 = practiceMode ? "Desliza para ir a los lados" : `Intento ${tryNo} de ${TRIES}`;
  } else if (state === "paused") { l1 = "⏸ Pausa"; l2 = "Toca para seguir"; }
  else if (state === "between") {
    const d = DEATHS[player.dead] || DEATHS.coche;
    l1 = `${d.icon} ${d.text}`;
    l2 = `${score} ${unit(score)} · ` + (practiceMode ? "toca para repetir" : `toca para el intento ${tryNo + 1}`);
  } else if (state === "over") { l1 = `Mejor: ${best} ${unit(best)}`; l2 = "Reto terminado"; }
  if (!l1) return;

  const y = H * 0.36;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = '700 15px "Nunito", system-ui, sans-serif';
  const w2 = ctx.measureText(l2).width;
  ctx.font = '700 24px "Baloo 2", system-ui, sans-serif';
  const bw = Math.min(W - 32, Math.max(ctx.measureText(l1).width, w2) + 40);
  ctx.globalAlpha = 0.93;
  ctx.fillStyle = C.surface;
  roundRectPath(W / 2 - bw / 2, y - 26, bw, 72, 18);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = C.text;
  ctx.fillText(l1, W / 2, y);
  ctx.font = '700 15px "Nunito", system-ui, sans-serif';
  ctx.fillStyle = C.soft;
  ctx.fillText(l2, W / 2, y + 27);
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  // el mundo se dibuja con y hacia abajo: la fila r ocupa [-(r+1)·TILE, -r·TILE]
  const oy = Math.round((H + camRow * TILE) * DPR) / DPR;
  const rTop = Math.ceil(camRow + H / TILE) + 1, rBot = Math.floor(camRow) - 1;
  ctx.save();
  ctx.translate(0, oy);
  for (let r = rBot; r <= rTop; r++) {
    const row = rows.get(r);
    if (row) drawRowBase(row, -(r + 1) * TILE);
  }
  // de arriba abajo: lo de delante tapa a lo de detrás
  const pr = Math.round(player.vRow);
  let drawn = false;
  for (let r = rTop; r >= rBot; r--) {
    if (r === pr) { drawPlayer(); drawn = true; }
    const row = rows.get(r);
    if (row) drawRowObjects(row, -(r + 1) * TILE);
  }
  if (!drawn) drawPlayer();
  drawParticles();
  drawFloaters();
  ctx.restore();
  drawLateWarning();
  drawScore();
  drawMessage();
}

/* ---------- modos ---------- */
function confirmLeaveChallenge() {
  return !inChallenge() || confirm("Si sales del reto pierdes los intentos que te quedan. ¿Seguro?");
}
function dropFocus() {
  // así la barra espaciadora avanza en vez de volver a pulsar el botón
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}
function startPractice() {
  if (!confirmLeaveChallenge()) return;
  practiceMode = true;
  tryNo = 0;
  best = 0;
  enterReady();
  setModeUI();
  dropFocus();
}
function startChallenge() {
  if (inChallenge()) { PiviCore.toast("Ya estás jugando el reto 😉"); return; }
  const st = policy?.canPlayWeekendChallenge ? policy.canPlayWeekendChallenge(GAME_ID) : { ok: true, reason: "" };
  if (!st.ok) { openModal("⛔ No disponible", st.reason); return; }
  if (!confirmLeaveChallenge()) return;
  practiceMode = false;
  challengePending = true; // se gasta con el primer movimiento
  tryNo = 1;
  best = 0;
  enterReady();
  setModeUI();
  dropFocus();
}
// "Reiniciar" / "Jugar otra": el reto solo se juega una vez, así que
// después (o desde práctica) siempre arranca una práctica
function restartSameMode() {
  if (inChallenge()) { PiviCore.toast("🔒 El reto no se puede reiniciar"); return; }
  startPractice();
}
// salir por ⬅️ / 🏠 a mitad del reto pide confirmación
if (window.PiviCore && PiviCore.guardChallenge) PiviCore.guardChallenge(inChallenge);

/* ---------- eventos ---------- */
// toque = avanzar (al levantar el dedo); deslizar = moverse en esa dirección
// (en cuanto el dedo recorre SWIPE_MIN, sin esperar a levantarlo)
let ptr = null;
function steering() { return state === "ready" || state === "playing"; }
if (window.PointerEvent) {
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!steering()) { handleInput(null); return; }
    ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, done: false };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* sin captura */ }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!ptr || ptr.done || e.pointerId !== ptr.id) return;
    const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
    if (Math.hypot(dx, dy) < SWIPE_MIN) return;
    ptr.done = true;
    handleInput(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!ptr || e.pointerId !== ptr.id) return;
    const p = ptr;
    ptr = null;
    if (!p.done) handleInput("up");
  });
  canvas.addEventListener("pointercancel", () => { ptr = null; });
  // click de teclado o lector de pantalla
  canvas.addEventListener("click", (e) => { if (e.detail === 0) handleInput(steering() ? "up" : null); });
} else {
  canvas.addEventListener("click", () => handleInput(steering() ? "up" : null));
}

const KEYS = {
  ArrowUp: "up", KeyW: "up", Space: "up",
  ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right"
};
document.addEventListener("keydown", (e) => {
  const dir = KEYS[e.code] || (e.key === " " ? "up" : null);
  if (!dir) return;
  if (state === "idle" || state === "over" || isOverlayOpen()) return;
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  e.preventDefault(); // que las flechas no muevan la página
  if (e.repeat) return; // mantener pulsado no encadena saltos
  handleInput(steering() ? dir : null);
});

// si se cambia de app a mitad del camino, al volver espera un toque
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state === "playing") {
    state = "paused";
    ptr = null;
    queued = null;
  }
});

practiceBtn.onclick = startPractice;
challengeBtn.onclick = startChallenge;
restartBtn.onclick = restartSameMode;

// colores del tema (claro/oscuro) para dibujar
new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

/* ---------- INIT ---------- */
(function init() {
  readColors();
  setupCanvas();
  resetWorld();
  placePlayerStart();
  state = "idle";
  updateHUD();
  updatePolicyStatus();
  openStartModal();
  requestAnimationFrame(frame);
})();
