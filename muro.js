/* muro.js — Muro de pinchos
   Un corazón avanza solo de pared en pared y cada toque le hace saltar.
   Cada pared tocada suma 1. Al rebotar, la pared de enfrente saca pinchos
   nuevos (cada vez más) y el corazón va un poco más rápido.
   Tocar un pincho (paredes, techo o suelo) acaba el intento.
   Reto: 3 intentos, cuenta el mejor. 1 punto por cada 3 paredes (máx. 10). */

const policy = window.PointsPolicy;
const GAME_ID = "muro";

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
const canvas = document.getElementById("muroCanvas");
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
const WALL = 6;                    // grosor de las paredes
const EDGE = 24;                   // franja de pinchos de techo y suelo
const SLOTS = 10;                  // huecos para pinchos en cada pared
const SLOT_H = (H - 2 * EDGE) / SLOTS;
const SPIKE_D = 26;                // lo que sobresale un pincho
const R = 14;                      // tamaño del corazón (dibujo y rebote)
const HIT_R = 10;                  // radio de choque: algo menor, perdona roces
const GRAVITY = 1450;              // px/s²
const JUMP = 470;                  // velocidad de salto (px/s)
const SPEED0 = 190;                // velocidad lateral al empezar
const SPEED_STEP = 4;              // + por cada pared
const SPEED_MAX = 290;
const STEP = 1 / 120;              // física a paso fijo (igual en pantallas de 60 y 120 Hz)
const READY_Y = H * 0.45;
const TRIES = 3;                   // intentos del reto (cuenta el mejor)
const SCORE_DIV = 3;               // paredes por punto
const MAX_SCORE = 10;
const DEAD_PAUSE = 750;            // ms tras chocar antes de aceptar otro toque

/* ---------- estado ---------- */
let practiceMode = true;
let state = "idle";                // idle | ready | playing | paused | dead | between | over
let tryNo = 0;
let best = 0;                      // mejor intento de esta tanda
let score = 0;                     // paredes del intento actual
let runId = 0;
const heart = { x: W / 2, y: READY_Y, vx: SPEED0, vy: 0, squash: 0 };
let walls = { L: newWall(), R: newWall() };
let trail = [];
let particles = [];
let scorePulse = 0;
let acc = 0, lastT = 0, clock = 0;

function newWall() { return { slots: [], ext: 0, target: 0, flash: 0 }; }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function approach(v, target, step) { return v < target ? Math.min(target, v + step) : Math.max(target, v - step); }
function ptsFor(s) { return clamp(Math.floor(s / SCORE_DIV), 0, MAX_SCORE); }
function speedFor(s) { return Math.min(SPEED0 + s * SPEED_STEP, SPEED_MAX); }
function isOverlayOpen() { return !!document.querySelector(".overlay:not(.hidden)"); }
function inChallenge() { return !practiceMode && state !== "idle" && state !== "over"; }

/* ---------- pinchos ---------- */
function spikeCount(s) { return Math.min(2 + Math.floor(s / 4), SLOTS - 3); } // 2 → 7
function safeGap(s) { return s < 12 ? 3 : 2; } // huecos libres seguidos que siempre hay

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Elige qué huecos de la pared llevan pincho. Siempre deja un paso libre
// de `gap` huecos seguidos, a una altura alcanzable desde donde está el corazón.
function makeSpikes(s, nearY) {
  const gap = safeGap(s);
  const n = Math.min(spikeCount(s), SLOTS - gap);
  const here = clamp(Math.floor((nearY - EDGE) / SLOT_H), 0, SLOTS - 1);
  const starts = [];
  for (let st = 0; st <= SLOTS - gap; st++) {
    if (Math.abs(st + (gap - 1) / 2 - here) <= 4) starts.push(st);
  }
  const st = starts[Math.floor(Math.random() * starts.length)];
  const pool = [];
  for (let i = 0; i < SLOTS; i++) if (i < st || i >= st + gap) pool.push(i);
  return shuffle(pool).slice(0, n);
}

function spikeTri(side, i, ext) {
  const pad = 3;
  const y0 = EDGE + i * SLOT_H + pad, y1 = EDGE + (i + 1) * SLOT_H - pad, ym = (y0 + y1) / 2;
  const d = SPIKE_D * ext;
  return side === "L"
    ? [WALL, y0, WALL + d, ym, WALL, y1]
    : [W - WALL, y0, W - WALL - d, ym, W - WALL, y1];
}

/* ---------- choques ---------- */
function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1) : 0;
  const cx = ax + t * dx - px, cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}
function sideOf(px, py, ax, ay, bx, by) { return (px - bx) * (ay - by) - (ax - bx) * (py - by); }
function inTri(px, py, t) {
  const d1 = sideOf(px, py, t[0], t[1], t[2], t[3]);
  const d2 = sideOf(px, py, t[2], t[3], t[4], t[5]);
  const d3 = sideOf(px, py, t[4], t[5], t[0], t[1]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
function hitsTri(px, py, r, t) {
  if (inTri(px, py, t)) return true;
  const r2 = r * r;
  return segDist2(px, py, t[0], t[1], t[2], t[3]) < r2
      || segDist2(px, py, t[2], t[3], t[4], t[5]) < r2
      || segDist2(px, py, t[4], t[5], t[0], t[1]) < r2;
}
function touchesSpikes() {
  if (heart.y - HIT_R < EDGE - 4 || heart.y + HIT_R > H - EDGE + 4) return true; // techo / suelo
  for (const side of ["L", "R"]) {
    const w = walls[side];
    if (w.ext < 0.35) continue; // pinchos aún saliendo o ya escondiéndose
    const far = side === "L" ? heart.x - HIT_R > WALL + SPIKE_D : heart.x + HIT_R < W - WALL - SPIKE_D;
    if (far) continue;
    for (const i of w.slots) if (hitsTri(heart.x, heart.y, HIT_R, spikeTri(side, i, w.ext))) return true;
  }
  return false;
}

/* ---------- modales ---------- */
function openModal(t, x) { modalTitle.textContent = t; modalText.textContent = x; overlay.classList.remove("hidden"); }
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
    ? "Elige modo. En Reto tienes 3 intentos y cuenta el mejor: 1 punto por cada 3 paredes. 1 vez por fin de semana."
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
function enterReady() {
  runId++;
  state = "ready";
  score = 0;
  heart.x = W / 2; heart.y = READY_Y; heart.vy = 0; heart.squash = 0;
  const dir = Math.random() < 0.5 ? 1 : -1;
  heart.vx = dir * SPEED0;
  walls = { L: newWall(), R: newWall() };
  const ahead = walls[dir > 0 ? "R" : "L"];
  ahead.slots = makeSpikes(0, READY_Y);
  ahead.target = 1;
  trail = []; particles = [];
  acc = 0;
  canvas.classList.remove("is-playing");
  updateHUD();
}

function jump() { heart.vy = -JUMP; heart.squash = 1; }

function bounce(side) {
  score++;
  scorePulse = 1;
  const v = speedFor(score);
  heart.vx = side === "L" ? v : -v;
  const hit = walls[side];
  const ahead = walls[side === "L" ? "R" : "L"];
  hit.target = 0;
  hit.flash = 1;
  ahead.slots = makeSpikes(score, heart.y);
  ahead.ext = 0;
  ahead.target = 1;
  updateHUD();
}

function physics(dt) {
  heart.vy += GRAVITY * dt;
  heart.y += heart.vy * dt;
  heart.x += heart.vx * dt;
  if (touchesSpikes()) { die(); return; }
  if (heart.vx < 0 && heart.x - R <= WALL) { heart.x = WALL + R; bounce("L"); }
  else if (heart.vx > 0 && heart.x + R >= W - WALL) { heart.x = W - WALL - R; bounce("R"); }
}

function die() {
  state = "dead";
  const id = runId;
  canvas.classList.remove("is-playing");
  burst(heart.x, heart.y);
  canvas.classList.remove("shake");
  void canvas.offsetWidth; // reinicia la animación
  canvas.classList.add("shake");
  try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) { /* sin vibración */ }
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
  const unit = best === 1 ? "pared" : "paredes";
  if (pts <= 0) {
    openModal("🏁 Fin del reto", `Mejor intento: ${best} ${unit}.\n\nHacen falta ${SCORE_DIV} para puntuar: 0 puntos.`);
  } else {
    const res = policy?.awardWeekendChallengePoints
      ? policy.awardWeekendChallengePoints(pts, GAME_ID)
      : { ok: false, reason: "No se pudo aplicar la política.", gained: 0 };
    if (res.ok) {
      openModal("🏆 ¡Qué rebotes!", `Mejor intento: ${best} ${unit}\n\nPuntos: +${res.gained}`);
      if (window.PiviCore) PiviCore.celebrate();
    } else {
      openModal("🏁 Fin del reto", `Mejor intento: ${best} ${unit}\n\nNo puntúa: ${res.reason}`);
    }
  }
  updatePolicyStatus();
  updateHUD();
}

function handleTap() {
  if (isOverlayOpen()) return;
  switch (state) {
    case "ready":
      state = "playing";
      canvas.classList.add("is-playing");
      jump();
      updateHUD();
      break;
    case "playing":
      jump();
      break;
    case "paused":
      state = "playing";
      canvas.classList.add("is-playing");
      jump();
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
function burst(x, y) {
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 220;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, life: 1, size: 3 + Math.random() * 4, heart: i % 3 === 0 });
  }
}
function updateParticles(dt) {
  for (const p of particles) {
    p.vy += 900 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt / 0.8;
  }
  particles = particles.filter(p => p.life > 0);
}

/* ---------- bucle ---------- */
function update(dt) {
  clock += dt;
  for (const side of ["L", "R"]) {
    const w = walls[side];
    w.ext = approach(w.ext, w.target, dt / 0.18);
    w.flash = Math.max(0, w.flash - dt / 0.3);
  }
  scorePulse = Math.max(0, scorePulse - dt / 0.25);
  heart.squash = Math.max(0, heart.squash - dt / 0.18);
  updateParticles(dt);

  if (state === "idle" || state === "ready") {
    heart.y = READY_Y + Math.sin(clock * 4) * 6; // flota mientras espera
    return;
  }
  if (state !== "playing") {
    if (trail.length) trail.shift(); // la estela se desvanece
    return;
  }
  acc += dt;
  while (acc >= STEP && state === "playing") { physics(STEP); acc -= STEP; }
  trail.push({ x: heart.x, y: heart.y });
  if (trail.length > 12) trail.shift();
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
  C = {
    bg: v("--surface-inset"), wall: v("--border-strong"), spike: v("--danger"),
    text: v("--text"), soft: v("--text-soft"), surface: v("--surface"),
    p1: v("--primary"), p2: v("--primary-strong")
  };
}

function setupCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function heartPath(s) {
  ctx.beginPath();
  ctx.moveTo(0, s * 0.95);
  ctx.bezierCurveTo(-s * 1.7, -s * 0.05, -s * 0.95, -s * 1.35, 0, -s * 0.5);
  ctx.bezierCurveTo(s * 0.95, -s * 1.35, s * 1.7, -s * 0.05, 0, s * 0.95);
  ctx.closePath();
}

function drawHeart() {
  const dir = heart.vx >= 0 ? 1 : -1;
  const tilt = state === "playing" ? clamp(heart.vy / 1400, -0.45, 0.45) * dir : 0;
  const sq = heart.squash;
  ctx.save();
  ctx.translate(heart.x, heart.y);
  ctx.rotate(tilt);
  ctx.scale(1 - 0.14 * sq, 1 + 0.16 * sq); // se estira un poco al saltar
  const g = ctx.createLinearGradient(0, -R, 0, R);
  g.addColorStop(0, C.p1);
  g.addColorStop(1, C.p2);
  heartPath(R);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,.6)";
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,.55)";
  ctx.beginPath();
  ctx.ellipse(-R * 0.48, -R * 0.42, R * 0.22, R * 0.13, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTrail() {
  const n = trail.length;
  ctx.fillStyle = C.p1;
  for (let i = 0; i < n; i++) {
    const k = (i + 1) / n;
    ctx.globalAlpha = 0.28 * k;
    ctx.beginPath();
    ctx.arc(trail[i].x, trail[i].y, R * 0.55 * k, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawEdges() {
  ctx.fillStyle = C.wall;
  ctx.fillRect(0, 0, W, 5);
  ctx.fillRect(0, H - 5, W, 5);
  const n = 12, w = W / n;
  ctx.fillStyle = C.spike;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x0 = i * w;
    ctx.moveTo(x0 + 2, 5); ctx.lineTo(x0 + w / 2, EDGE - 2); ctx.lineTo(x0 + w - 2, 5); ctx.closePath();
    ctx.moveTo(x0 + 2, H - 5); ctx.lineTo(x0 + w / 2, H - EDGE + 2); ctx.lineTo(x0 + w - 2, H - 5); ctx.closePath();
  }
  ctx.fill();
}

function drawWall(side) {
  const w = walls[side];
  const x = side === "L" ? 0 : W - WALL;
  ctx.fillStyle = C.wall;
  ctx.fillRect(x, 0, WALL, H);
  if (w.flash > 0) {
    ctx.globalAlpha = w.flash;
    ctx.fillStyle = C.p1;
    ctx.fillRect(x, EDGE, WALL, H - 2 * EDGE);
    ctx.globalAlpha = 1;
  }
  if (w.ext <= 0.01 || !w.slots.length) return;
  const tris = w.slots.map(i => spikeTri(side, i, w.ext));
  ctx.fillStyle = C.spike;
  ctx.beginPath();
  for (const t of tris) { ctx.moveTo(t[0], t[1]); ctx.lineTo(t[2], t[3]); ctx.lineTo(t[4], t[5]); ctx.closePath(); }
  ctx.fill();
  // cara superior más clara: da relieve
  ctx.fillStyle = "rgba(255,255,255,.22)";
  ctx.beginPath();
  for (const t of tris) { ctx.moveTo(t[0], t[1]); ctx.lineTo(t[2], t[3]); ctx.lineTo(t[0], (t[1] + t[5]) / 2); ctx.closePath(); }
  ctx.fill();
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = clamp(p.life, 0, 1);
    ctx.fillStyle = p.heart ? C.p1 : C.spike;
    if (p.heart) {
      ctx.save();
      ctx.translate(p.x, p.y);
      heartPath(p.size * 1.3);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawMessage() {
  let l1 = "", l2 = "";
  if (state === "idle") { l1 = "Elige un modo"; l2 = "para empezar"; }
  else if (state === "ready") { l1 = "Toca para saltar"; l2 = practiceMode ? "Práctica" : `Intento ${tryNo} de ${TRIES}`; }
  else if (state === "paused") { l1 = "⏸ Pausa"; l2 = "Toca para seguir"; }
  else if (state === "between") {
    l1 = `💥 ${score} ${score === 1 ? "pared" : "paredes"}`;
    l2 = practiceMode ? "Toca para volver a jugar" : `Toca para el intento ${tryNo + 1} de ${TRIES}`;
  } else if (state === "over") { l1 = `Mejor: ${best}`; l2 = "Reto terminado"; }
  if (!l1) return;

  const y = H * 0.7;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = '700 15px "Nunito", system-ui, sans-serif';
  const w2 = ctx.measureText(l2).width;
  ctx.font = '700 26px "Baloo 2", system-ui, sans-serif';
  const bw = Math.min(W - 2 * (WALL + SPIKE_D + 8), Math.max(ctx.measureText(l1).width, w2) + 40);
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = C.surface;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(W / 2 - bw / 2, y - 26, bw, 72, 18);
  else ctx.rect(W / 2 - bw / 2, y - 26, bw, 72);
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
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // marcador grande al fondo
  if (state !== "idle") {
    ctx.save();
    ctx.globalAlpha = 0.13 + 0.12 * scorePulse;
    ctx.fillStyle = C.text;
    ctx.font = `700 ${Math.round(130 * (1 + 0.12 * scorePulse))}px "Baloo 2", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(score), W / 2, H * 0.28);
    ctx.restore();
  }

  drawEdges();
  drawWall("L");
  drawWall("R");
  drawTrail();
  if (state === "idle" || state === "ready" || state === "playing" || state === "paused") drawHeart();
  drawParticles();
  drawMessage();
}

/* ---------- modos ---------- */
function confirmLeaveChallenge() {
  return !inChallenge() || confirm("Si sales del reto pierdes los intentos que te quedan. ¿Seguro?");
}
function dropFocus() {
  // así la barra espaciadora salta en vez de volver a pulsar el botón
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
  const st = policy?.canPlayWeekendChallenge ? policy.canPlayWeekendChallenge(GAME_ID) : { ok: true, reason: "" };
  if (!st.ok) { openModal("⛔ No disponible", st.reason); return; }
  if (!confirmLeaveChallenge()) return;
  practiceMode = false;
  policy?.markWeekendChallengePlayed?.(GAME_ID);
  tryNo = 1;
  best = 0;
  enterReady();
  setModeUI();
  dropFocus();
}
function restartSameMode() { if (practiceMode) startPractice(); else startChallenge(); }

/* ---------- eventos ---------- */
// al APOYAR el dedo: saltos rápidos seguidos sin perder ninguno
if (window.PiviCore && PiviCore.onTap) PiviCore.onTap(canvas, handleTap);
else canvas.addEventListener("click", handleTap);

document.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.code !== "Space" && e.key !== " " && e.key !== "ArrowUp") return;
  if (state === "idle" || state === "over" || isOverlayOpen()) return;
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  e.preventDefault();
  handleTap();
});

// si se cambia de app a mitad de salto, al volver espera un toque
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state === "playing") {
    state = "paused";
    canvas.classList.remove("is-playing");
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
  state = "idle";
  updateHUD();
  updatePolicyStatus();
  openStartModal();
  requestAnimationFrame(frame);
})();
