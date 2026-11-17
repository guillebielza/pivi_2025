/* vuelo.js — Carta voladora
   Una carta de amor con alas avanza sola; cada toque la hace aletear
   hacia arriba y la gravedad la va bajando. Hay que pasar por el hueco
   entre las columnas de piruleta sin tocarlas ni tocar el suelo.
   Cada columna superada suma 1. Poco a poco va más rápido y los huecos
   se estrechan un poco.
   Reto: 3 intentos, cuenta el mejor. 1 punto por cada 2 columnas (máx. 10). */

const policy = window.PointsPolicy;
const GAME_ID = "vuelo";

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
const canvas = document.getElementById("vueloCanvas");
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
const GROUND_H = 46;
const GROUND_Y = H - GROUND_H;     // donde empieza el suelo
const LETTER_X = 104;              // la carta no se mueve en horizontal: se mueve el mundo
const EW = 32, EH = 22;            // tamaño del sobre (dibujo)
const HIT_R = 9;                   // choque: dos círculos a lo largo del sobre,
const HIT_OFF = 6;                 //   algo menores que el dibujo (perdonan roces)
const GRAVITY = 1350;              // px/s²
const FLAP = 400;                  // velocidad del aleteo (px/s hacia arriba)
const MAX_FALL = 620;
const COL_W = 58;                  // ancho de las columnas
const SPACING = 205;               // distancia entre columnas
const SPEED0 = 150;                // velocidad al empezar (px/s)
const SPEED_STEP = 2;              // + por cada columna superada
const SPEED_MAX = 200;
const GAP0 = 168;                  // hueco al empezar
const GAP_STEP = 2;                // − por cada columna
const GAP_MIN = 128;
const MARGIN = 44;                 // el hueco nunca pega al techo ni al suelo
const MAX_SHIFT = 130;             // cuánto puede cambiar la altura del hueco de una columna a otra
                                   //   (con más, al final hay subidas casi imposibles)
const FIRST_X = W + 70;            // la primera columna tarda un poco: da tiempo a cogerle el ritmo
const STEP = 1 / 120;              // física a paso fijo (igual en pantallas de 60 y 120 Hz)
const READY_Y = H * 0.42;
const TRIES = 3;                   // intentos del reto (cuenta el mejor)
const SCORE_DIV = 2;               // columnas por punto
const MAX_SCORE = 10;
const DEAD_PAUSE = 750;            // ms tras chocar antes de aceptar otro toque

/* ---------- estado ---------- */
let practiceMode = true;
let state = "idle";                // idle | ready | playing | paused | dead | between | over
let tryNo = 0;
let best = 0;                      // mejor intento de esta tanda
let score = 0;                     // columnas del intento actual
let runId = 0;
const letter = { x: LETTER_X, y: READY_Y, vy: 0, rot: 0, squash: 0, wing: 0, flapBoost: 0 };
let cols = [];
let spawned = 0;                   // columnas creadas en este intento (marca la dificultad)
let lastGapY = READY_Y;
let particles = [];
let scorePulse = 0;
let groundX = 0, hillX = 0;        // desplazamiento del fondo (parallax)
let clouds = [];
let stars = [];
let acc = 0, lastT = 0, clock = 0;

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function ptsFor(s) { return clamp(Math.floor(s / SCORE_DIV), 0, MAX_SCORE); }
function speedFor(s) { return Math.min(SPEED0 + s * SPEED_STEP, SPEED_MAX); }
function gapFor(n) { return Math.max(GAP0 - n * GAP_STEP, GAP_MIN); }
function isOverlayOpen() { return !!document.querySelector(".overlay:not(.hidden)"); }
let challengePending = false; // reto elegido pero aún sin el primer toque
function inChallenge() { return !practiceMode && !challengePending && state !== "idle" && state !== "over"; }

/* ---------- columnas ---------- */
function newCol(x) {
  const gap = gapFor(spawned);
  const lo = MARGIN + gap / 2, hi = GROUND_Y - MARGIN - gap / 2;
  // altura del hueco al azar, pero sin saltos imposibles desde la anterior
  const y = clamp(lo + Math.random() * (hi - lo), lastGapY - MAX_SHIFT, lastGapY + MAX_SHIFT);
  lastGapY = y;
  spawned++;
  return { x, y, gap, passed: false, flash: 0 };
}

function circleRect(cx, cy, r, x, y, w, h) {
  const nx = clamp(cx, x, x + w), ny = clamp(cy, y, y + h);
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

// la carta es más ancha que alta: se comprueba con dos círculos a lo largo del sobre
function hitPoints() {
  const ox = Math.cos(letter.rot) * HIT_OFF, oy = Math.sin(letter.rot) * HIT_OFF;
  return [[letter.x - ox, letter.y - oy], [letter.x + ox, letter.y + oy]];
}

function hitsColumn() {
  const pts = hitPoints();
  for (const c of cols) {
    if (c.x > letter.x + EW || c.x + COL_W < letter.x - EW) continue;
    const top = c.y - c.gap / 2, bot = c.y + c.gap / 2;
    for (const [px, py] of pts) {
      if (circleRect(px, py, HIT_R, c.x, -60, COL_W, top + 60)) return true;
      if (circleRect(px, py, HIT_R, c.x, bot, COL_W, GROUND_Y - bot)) return true;
    }
  }
  return false;
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
    ? "Elige modo. En Reto tienes 3 intentos y cuenta el mejor: 1 punto por cada 2 columnas. 1 vez por fin de semana. Si sales a mitad, pierdes los intentos que te queden."
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
  letter.y = READY_Y; letter.vy = 0; letter.rot = 0; letter.squash = 0;
  cols = [];
  spawned = 0;
  lastGapY = READY_Y;
  particles = [];
  acc = 0;
  canvas.classList.remove("is-playing");
  updateHUD();
}

function flap() {
  letter.vy = -FLAP;
  letter.squash = 1;
  letter.flapBoost = 1;
  puff();
}

function physics(dt) {
  letter.vy = Math.min(letter.vy + GRAVITY * dt, MAX_FALL);
  letter.y += letter.vy * dt;
  // techo: no elimina, solo frena (las columnas llegan hasta arriba, no se puede pasar por encima)
  if (letter.y < HIT_R + 2) { letter.y = HIT_R + 2; if (letter.vy < 0) letter.vy = 0; }
  const target = letter.vy < 0 ? -0.38 : clamp(letter.vy / MAX_FALL, 0, 1) * 1.15 - 0.15;
  letter.rot += (target - letter.rot) * Math.min(1, dt * 9);

  const dx = speedFor(score) * dt;
  scrollWorld(dx);
  for (const c of cols) c.x -= dx;
  if (cols.length && cols[0].x + COL_W < -8) cols.shift();
  const last = cols[cols.length - 1];
  if (!last) cols.push(newCol(FIRST_X));
  else if (last.x <= W + 10 - SPACING) cols.push(newCol(last.x + SPACING));

  for (const c of cols) {
    if (!c.passed && c.x + COL_W / 2 < letter.x) {
      c.passed = true;
      c.flash = 1;
      score++;
      scorePulse = 1;
      updateHUD();
    }
  }

  if (letter.y + HIT_R >= GROUND_Y) { letter.y = GROUND_Y - HIT_R; die(); return; }
  if (hitsColumn()) die();
}

function die() {
  state = "dead";
  const id = runId;
  canvas.classList.remove("is-playing");
  burst(letter.x, letter.y);
  canvas.classList.remove("shake");
  void canvas.offsetWidth; // reinicia la animación
  canvas.classList.add("shake");
  try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) { /* sin vibración */ }
  if (letter.vy < 0) letter.vy = 0;
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
  const unit = best === 1 ? "columna" : "columnas";
  if (pts <= 0) {
    openModal("🏁 Fin del reto", `Mejor intento: ${best} ${unit}.\n\nHacen falta ${SCORE_DIV} para puntuar: 0 puntos.`);
  } else {
    const res = policy?.awardWeekendChallengePoints
      ? policy.awardWeekendChallengePoints(pts, GAME_ID)
      : { ok: false, reason: "No se pudo aplicar la política.", gained: 0 };
    if (res.ok) {
      openModal("🏆 ¡Carta entregada!", `Mejor intento: ${best} ${unit}\n\nPuntos: +${res.gained}`);
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
      if (!practiceMode && challengePending) {
        const st = policy?.canPlayWeekendChallenge ? policy.canPlayWeekendChallenge(GAME_ID) : { ok: true, reason: "" };
        if (!st.ok) { state = "over"; challengePending = false; openModal("⛔ No disponible", st.reason); return; }
        policy?.markWeekendChallengePlayed?.(GAME_ID);
        challengePending = false;
        updatePolicyStatus();
      }
      state = "playing";
      canvas.classList.add("is-playing");
      flap();
      updateHUD();
      break;
    case "playing":
      flap();
      break;
    case "paused":
      state = "playing";
      canvas.classList.add("is-playing");
      flap();
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
// dos corazoncitos que salen por detrás al aletear
function puff() {
  for (let i = 0; i < 2; i++) {
    particles.push({
      x: letter.x - 14, y: letter.y + 4 + i * 4,
      vx: -50 - Math.random() * 50, vy: 30 + Math.random() * 50, g: 0,
      life: 1, decay: 1 / 0.55, size: 2.4 + Math.random() * 1.4, kind: "heart", rot: 0, vr: 0
    });
  }
}
function burst(x, y) {
  for (let i = 0; i < 18; i++) {
    const a = Math.random() * Math.PI * 2, sp = 110 + Math.random() * 200;
    particles.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 140, g: 900,
      life: 1, decay: 1 / 0.85, size: 3 + Math.random() * 4,
      kind: i % 3 === 0 ? "heart" : "paper",
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 12
    });
  }
}
function updateParticles(dt) {
  for (const p of particles) {
    p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    p.life -= dt * p.decay;
  }
  particles = particles.filter(p => p.life > 0);
}

/* ---------- fondo ---------- */
function initScenery() {
  clouds = [];
  for (let i = 0; i < 5; i++) { // repartidas a lo ancho, sin amontonarse
    clouds.push({ x: i * (W + 120) / 5 - 40 + Math.random() * 30, y: 40 + Math.random() * 230, s: 0.7 + Math.random() * 0.6 });
  }
  stars = [];
  for (let i = 0; i < 28; i++) {
    stars.push({ x: Math.random() * W, y: Math.random() * (GROUND_Y - 120), r: 0.6 + Math.random() * 1.1, t: Math.random() * 6 });
  }
}
function scrollWorld(dx) {
  groundX = (groundX + dx) % 1e6;
  hillX = (hillX + dx * 0.35) % 1e6;
  for (const c of clouds) {
    c.x -= dx * 0.18 * c.s;
    if (c.x < -70 * c.s) { c.x = W + 50 + Math.random() * 80; c.y = 40 + Math.random() * 230; }
  }
}

/* ---------- bucle ---------- */
function update(dt) {
  clock += dt;
  scorePulse = Math.max(0, scorePulse - dt / 0.25);
  letter.squash = Math.max(0, letter.squash - dt / 0.18);
  letter.flapBoost = Math.max(0, letter.flapBoost - dt / 0.3);
  // alas: rápidas justo después de aletear, planeo suave el resto del tiempo
  letter.wing += dt * (7 + 22 * letter.flapBoost);
  for (const c of cols) c.flash = Math.max(0, c.flash - dt / 0.35);
  updateParticles(dt);

  if (state === "idle" || state === "ready") {
    letter.y = READY_Y + Math.sin(clock * 4) * 7; // flota mientras espera
    letter.rot = Math.sin(clock * 4 + 1) * 0.06;
    scrollWorld(SPEED0 * dt);
    return;
  }
  if (state === "dead" || state === "between" || state === "over") {
    // cae al suelo dando vueltas
    if (letter.y + HIT_R < GROUND_Y) {
      letter.vy = Math.min(letter.vy + GRAVITY * dt, MAX_FALL);
      letter.y = Math.min(letter.y + letter.vy * dt, GROUND_Y - HIT_R);
      letter.rot = Math.min(letter.rot + dt * 6, 1.45);
    }
    return;
  }
  if (state !== "playing") return; // en pausa todo quieto
  acc += dt;
  while (acc >= STEP && state === "playing") { physics(STEP); acc -= STEP; }
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
    p1: v("--primary"), p2: v("--primary-strong"), danger: v("--danger"),
    skyTop: dark ? "#1b1422" : "#ffe0e7",
    skyBot: dark ? "#2b1f2b" : "#fff3ea",
    cloud: dark ? "rgba(255,255,255,.07)" : "rgba(255,255,255,.85)",
    hill: dark ? "#33243a" : "#f8d9cf",
    hill2: dark ? "#2a1e2e" : "#f3cabd",
    ground: dark ? "#3b2a36" : "#f2d2bf",
    groundDots: dark ? "rgba(255,255,255,.07)" : "rgba(255,255,255,.55)",
    frosting: dark ? "#d96a80" : "#ff9fb0",
    paper: dark ? "#fbefe9" : "#ffffff",
    ink: dark ? "#8f6168" : "#b77d70",
    wing: dark ? "#ffffff" : "#ffffff",
    wingBack: dark ? "#d8c4c3" : "#f3e1d9",
    colBase: dark ? "#3f2d3a" : "#fff7ef",
    colStripe: dark ? "#ff8598" : "#ff8da1",
    colEdge: dark ? "#ff6b81" : "#e8687e"
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

function roundRectPath(x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  g.addColorStop(0, C.skyTop);
  g.addColorStop(1, C.skyBot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, GROUND_Y);
  if (C.dark) {
    ctx.fillStyle = "#fff";
    for (const s of stars) {
      ctx.globalAlpha = 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(clock * 1.6 + s.t));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // todas las nubes en un solo trazo: las partes que se solapan no se ven más opacas
  const puff = (x, y, r) => { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); };
  ctx.fillStyle = C.cloud;
  ctx.beginPath();
  for (const c of clouds) {
    const s = c.s;
    puff(c.x, c.y, 16 * s);
    puff(c.x + 18 * s, c.y - 9 * s, 20 * s);
    puff(c.x + 40 * s, c.y, 15 * s);
    ctx.rect(c.x, c.y - 2 * s, 40 * s, 17 * s);
  }
  ctx.fill();
}

function drawHills() {
  const layer = (color, base, amp1, len1, amp2, len2, off) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    for (let x = 0; x <= W; x += 6) {
      const k = x + off;
      ctx.lineTo(x, base - amp1 * (0.5 + 0.5 * Math.sin(k / len1)) - amp2 * Math.sin(k / len2));
    }
    ctx.lineTo(W, GROUND_Y);
    ctx.closePath();
    ctx.fill();
  };
  layer(C.hill, GROUND_Y - 34, 46, 58, 8, 21, hillX * 0.6 + 400);
  layer(C.hill2, GROUND_Y - 10, 26, 41, 5, 17, hillX);
}

function drawGround() {
  ctx.fillStyle = C.ground;
  ctx.fillRect(0, GROUND_Y, W, GROUND_H);
  // corazoncitos en el suelo que se desplazan con el mundo
  ctx.fillStyle = C.groundDots;
  const step = 36, off = groundX % step;
  for (let x = -off; x < W + step; x += step) {
    ctx.save();
    ctx.translate(x + 10, GROUND_Y + 27);
    heartPath(3.4);
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x + 28, GROUND_Y + 38, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // borde de glaseado ondulado
  ctx.fillStyle = C.frosting;
  ctx.fillRect(0, GROUND_Y, W, 6);
  const s2 = 18, o2 = groundX % s2;
  ctx.beginPath();
  for (let x = -o2; x < W + s2; x += s2) {
    ctx.moveTo(x, GROUND_Y + 5);
    ctx.arc(x + s2 / 2, GROUND_Y + 5, s2 / 2, 0, Math.PI);
  }
  ctx.fill();
}

// columna de piruleta: base clara con rayas en diagonal, redondeada en el lado del hueco
function pillarPath(x, y, w, h, r, endAtBottom) {
  ctx.beginPath();
  if (endAtBottom) {
    ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.closePath();
  } else {
    ctx.moveTo(x, y + h); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h); ctx.closePath();
  }
}
function drawPillar(x, y, w, h, endAtBottom, flash) {
  if (h <= 0) return;
  const r = 16;
  ctx.save();
  pillarPath(x, y, w, h, r, endAtBottom);
  ctx.fillStyle = C.colBase;
  ctx.fill();
  ctx.clip();
  // rayas (ancladas al extremo del hueco, así no "bailan")
  const anchor = endAtBottom ? y + h : y;
  ctx.fillStyle = C.colStripe;
  ctx.beginPath();
  const band = 11, period = 26, slope = 22;
  for (let k = -period * 2; k < h + period * 2; k += period) {
    const yy = endAtBottom ? anchor - k : anchor + k;
    ctx.moveTo(x, yy);
    ctx.lineTo(x + w, yy - slope);
    ctx.lineTo(x + w, yy - slope + band);
    ctx.lineTo(x, yy + band);
    ctx.closePath();
  }
  ctx.fill();
  // volumen: brillo a la izquierda, sombra a la derecha
  ctx.fillStyle = "rgba(255,255,255,.28)";
  ctx.fillRect(x + 7, y, 7, h);
  ctx.fillStyle = "rgba(0,0,0,.08)";
  ctx.fillRect(x + w - 12, y, 12, h);
  if (flash > 0) {
    ctx.globalAlpha = 0.45 * flash;
    ctx.fillStyle = "#fff";
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  pillarPath(x, y, w, h, r, endAtBottom);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = C.colEdge;
  ctx.stroke();
}
function drawColumns() {
  for (const c of cols) {
    if (c.x > W + 4 || c.x + COL_W < -4) continue;
    const top = c.y - c.gap / 2, bot = c.y + c.gap / 2;
    drawPillar(c.x, -20, COL_W, top + 20, true, c.flash);
    drawPillar(c.x, bot, COL_W, GROUND_Y - bot + 8, false, c.flash);
  }
}

// ala: tres plumas redondeadas en abanico hacia arriba y atrás;
// a > 0 la levanta (gira hacia delante), a < 0 la baja
const FEATHERS = [[-1.85, 16, 4.8], [-2.3, 14, 4.4], [-2.75, 11, 4]]; // [dirección, largo, grosor]
function drawWing(px, py, a, fill) {
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(a);
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = C.ink;
  ctx.fillStyle = fill;
  for (let i = FEATHERS.length - 1; i >= 0; i--) {
    const [dir, len, wd] = FEATHERS[i];
    ctx.save();
    ctx.rotate(dir);
    ctx.beginPath();
    ctx.ellipse(len / 2, 0, len / 2 + 1, wd, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawLetter() {
  const amp = 0.25 + 0.45 * letter.flapBoost;
  const a = 0.1 + Math.sin(letter.wing) * amp;
  const sq = letter.squash;
  const x0 = -EW / 2, y0 = -EH / 2;
  ctx.save();
  ctx.translate(letter.x, letter.y);
  ctx.rotate(letter.rot);
  ctx.scale(1 + 0.07 * sq, 1 - 0.09 * sq);
  drawWing(-1, y0 + 4, a * 0.85 - 0.2, C.wingBack); // ala de detrás
  // sobre
  roundRectPath(x0, y0, EW, EH, 4);
  ctx.fillStyle = C.paper;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = C.ink;
  ctx.stroke();
  // pliegues de abajo
  ctx.globalAlpha = 0.4;
  ctx.beginPath();
  ctx.moveTo(x0 + 2, y0 + EH - 2); ctx.lineTo(-4, 1);
  ctx.moveTo(x0 + EW - 2, y0 + EH - 2); ctx.lineTo(4, 1);
  ctx.stroke();
  ctx.globalAlpha = 1;
  // solapa
  ctx.beginPath();
  ctx.moveTo(x0 + 1.5, y0 + 1.5); ctx.lineTo(0, 3.5); ctx.lineTo(x0 + EW - 1.5, y0 + 1.5);
  ctx.stroke();
  // sello de corazón
  ctx.save();
  ctx.translate(0, 3.5);
  heartPath(4.6);
  ctx.fillStyle = C.p2;
  ctx.fill();
  ctx.restore();
  drawWing(1, y0 + 3, a, C.wing); // ala de delante
  ctx.restore();
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = clamp(p.life, 0, 1);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    if (p.kind === "heart") {
      ctx.fillStyle = C.p1;
      heartPath(p.size * 1.2);
      ctx.fill();
    } else {
      ctx.fillStyle = C.paper;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1;
      ctx.fillRect(-p.size, -p.size * 0.7, p.size * 2, p.size * 1.4);
      ctx.strokeRect(-p.size, -p.size * 0.7, p.size * 2, p.size * 1.4);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawScore() {
  if (state === "idle") return;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const size = Math.round(46 * (1 + 0.18 * scorePulse));
  ctx.font = `800 ${size}px "Baloo 2", system-ui, sans-serif`;
  ctx.lineJoin = "round";
  ctx.lineWidth = 7;
  ctx.strokeStyle = C.surface;
  ctx.strokeText(String(score), W / 2, 58);
  ctx.fillStyle = C.text;
  ctx.fillText(String(score), W / 2, 58);
  ctx.restore();
}

function drawMessage() {
  let l1 = "", l2 = "";
  if (state === "idle") { l1 = "Elige un modo"; l2 = "para empezar"; }
  else if (state === "ready") { l1 = "👆 Toca para volar"; l2 = practiceMode ? "Práctica" : `Intento ${tryNo} de ${TRIES}`; }
  else if (state === "paused") { l1 = "⏸ Pausa"; l2 = "Toca para seguir"; }
  else if (state === "between") {
    l1 = `💥 ${score} ${score === 1 ? "columna" : "columnas"}`;
    l2 = practiceMode ? "Toca para volver a jugar" : `Toca para el intento ${tryNo + 1} de ${TRIES}`;
  } else if (state === "over") { l1 = `Mejor: ${best}`; l2 = "Reto terminado"; }
  if (!l1) return;

  const y = H * 0.62;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = '700 15px "Nunito", system-ui, sans-serif';
  const w2 = ctx.measureText(l2).width;
  ctx.font = '700 26px "Baloo 2", system-ui, sans-serif';
  const bw = Math.min(W - 48, Math.max(ctx.measureText(l1).width, w2) + 40);
  ctx.globalAlpha = 0.92;
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
  drawSky();
  drawHills();
  drawColumns();
  drawGround();
  drawLetter();
  drawParticles();
  drawScore();
  drawMessage();
}

/* ---------- modos ---------- */
function confirmLeaveChallenge() {
  return !inChallenge() || confirm("Si sales del reto pierdes los intentos que te quedan. ¿Seguro?");
}
function dropFocus() {
  // así la barra espaciadora aletea en vez de volver a pulsar el botón
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
  challengePending = true; // se gasta con el primer toque
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
// al APOYAR el dedo: aleteos rápidos seguidos sin perder ninguno
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

// si se cambia de app a mitad de vuelo, al volver espera un toque
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
  initScenery();
  state = "idle";
  updateHUD();
  updatePolicyStatus();
  openStartModal();
  requestAnimationFrame(frame);
})();
