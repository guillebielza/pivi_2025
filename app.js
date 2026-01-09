let pointsEl = document.getElementById("points");
const experiencesEl = document.getElementById("experiences");
const giftsEl = document.getElementById("gifts");
const redeemedListEl = document.getElementById("redeemedList");
let popupOverlay = document.getElementById("popupOverlay");
let popupText = document.getElementById("popupText");

/* ================== STORAGE ================== */
function getPoints() {
  return Number(localStorage.getItem("points")) || 0;
}
function setPoints(value) {
  localStorage.setItem("points", value);
  if (pointsEl) pointsEl.textContent = value;
}

function getRedeemed() {
  return JSON.parse(localStorage.getItem("redeemedRewards")) || [];
}
function setRedeemed(arr) {
  localStorage.setItem("redeemedRewards", JSON.stringify(arr));
}

/* ================== POPUP ================== */
function showPopup(text) {
  if (!popupText || !popupOverlay) return;
  popupText.textContent = text;
  popupOverlay.classList.remove("hidden");
}

const closePopupBtn = document.getElementById("closePopup");
if (closePopupBtn) {
  closePopupBtn.onclick = () => popupOverlay.classList.add("hidden");
}

/* ================== CELEBRACIÓN (MAS CONFETI + AUDIO MAS DIVERTIDO) ================== */
const fxCanvas = document.getElementById("fxCanvas");
let fxCtx = fxCanvas ? fxCanvas.getContext("2d") : null;
let fxAnimId = null;

function resizeFxCanvas(){
  if (!fxCanvas) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  fxCanvas.width = Math.floor(window.innerWidth * dpr);
  fxCanvas.height = Math.floor(window.innerHeight * dpr);
  fxCanvas.style.width = "100%";
  fxCanvas.style.height = "100%";
  if (fxCtx) fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resizeFxCanvas);
resizeFxCanvas();

/* confeti mas potente */
function celebrateConfetti(durationMs = 2400){
  if (!fxCanvas || !fxCtx) return;

  if (fxAnimId) cancelAnimationFrame(fxAnimId);
  fxCanvas.style.display = "block";

  const W = window.innerWidth;
  const H = window.innerHeight;
  const centerX = W / 2;
  const centerY = Math.min(H * 0.36, 260);

  const colors = ["#ff595e","#ffca3a","#8ac926","#1982c4","#6a4c93","#ffd6a5","#caffbf","#9bf6ff","#a0c4ff","#ffc6ff"];
  const particles = [];
  const count = 320; // MAS

  for (let i = 0; i < count; i++){
    const angle = (Math.random() * Math.PI) - (Math.PI / 2);
    const speed = 7 + Math.random() * 12;

    particles.push({
      x: centerX,
      y: centerY,
      vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 3.2,
      vy: Math.sin(angle) * speed - (Math.random() * 4),
      g: 0.16 + Math.random() * 0.18,
      w: 6 + Math.random() * 10,
      h: 3 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.35,
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  }

  const start = performance.now();

  function frame(t){
    const elapsed = t - start;
    fxCtx.clearRect(0, 0, W, H);

    for (const p of particles){
      p.vy += p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;

      p.vx *= 0.991;
      p.vy *= 0.999;

      fxCtx.save();
      fxCtx.translate(p.x, p.y);
      fxCtx.rotate(p.rot);
      fxCtx.fillStyle = p.color;
      fxCtx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
      fxCtx.restore();
    }

    if (elapsed < durationMs){
      fxAnimId = requestAnimationFrame(frame);
    } else {
      fxCtx.clearRect(0, 0, W, H);
      fxCanvas.style.display = "none";
      fxAnimId = null;
    }
  }

  fxAnimId = requestAnimationFrame(frame);
}

/* audio mas divertido (mini jingle arcade) */
let audioCtx = null;

function playWinJingle(){
  try{
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;

    const master = audioCtx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    master.connect(audioCtx.destination);

    const osc = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    osc.type = "square";
    osc2.type = "triangle";

    const g1 = audioCtx.createGain();
    const g2 = audioCtx.createGain();
    g1.gain.value = 0.9;
    g2.gain.value = 0.55;

    osc.connect(g1); g1.connect(master);
    osc2.connect(g2); g2.connect(master);

    // jingle: sube rapido con saltitos
    const seq = [523.25, 659.25, 783.99, 987.77, 1046.5, 1318.51]; // C E G B D E
    const step = 0.09;

    seq.forEach((f, i) => {
      const t = now + i * step;
      osc.frequency.setValueAtTime(f, t);
      osc2.frequency.setValueAtTime(f / 2, t);
    });

    // pequeño "glide" final
    osc.frequency.linearRampToValueAtTime(1567.98, now + seq.length * step + 0.08);
    osc2.frequency.linearRampToValueAtTime(783.99, now + seq.length * step + 0.08);

    osc.start(now);
    osc2.start(now);
    osc.stop(now + 0.95);
    osc2.stop(now + 0.95);
  } catch(e){
    // si bloquea, sin sonido
  }
}

function celebrateWin(){
  celebrateConfetti(2400);
  playWinJingle();
}

/* ================== RECOMPENSAS ================== */
let rewardsData = [];

function isAvailable(reward){
  return reward && (reward.disponible !== false);
}

function renderRewards() {
  if (!experiencesEl || !giftsEl || !redeemedListEl) return;
  const redeemed = getRedeemed();

  experiencesEl.innerHTML = "";
  giftsEl.innerHTML = "";
  redeemedListEl.innerHTML = "";

  rewardsData.forEach((r) => {
    const div = document.createElement("div");
    div.className = "reward";
    div.innerHTML = `
      ${r.textoBoton}
      <span>${r.coste} pts</span>
    `;

    const alreadyRedeemed = redeemed.includes(r.id);
    const available = isAvailable(r);

    if (alreadyRedeemed) {
      div.classList.add("disabled");
      if (r.mensajeHistorico) redeemedListEl.innerHTML += `<li>${r.mensajeHistorico}</li>`;
    } else if (!available) {
      div.classList.add("unavailable");
      div.title = "No disponible ahora";
      div.onclick = () => showPopup("⛔ Esta recompensa no esta disponible ahora mismo.");
    } else {
      div.onclick = () => redeemReward(r.id);
    }

    (r.tipo === "Experiencia" ? experiencesEl : giftsEl).appendChild(div);
  });
}

function redeemReward(rewardId) {
  const reward = rewardsData.find(r => r.id === rewardId);
  if (!reward) return showPopup("Ha ocurrido un error: recompensa no encontrada.");

  if (!isAvailable(reward)) {
    return showPopup("⛔ Esta recompensa no esta disponible ahora mismo.");
  }

  let points = getPoints();
  if (points < reward.coste) return showPopup("No tienes suficientes puntos");

  setPoints(points - reward.coste);

  const redeemed = getRedeemed();
  redeemed.push(reward.id);
  setRedeemed(redeemed);

  // 🎉 canje exitoso -> fiesta
  celebrateWin();

  showPopup(reward.mensajePopup || "✅ Recompensa canjeada");
  renderRewards();
}

/* ================== RETOS (SIEMPRE ACTIVO) ================== */
const goToChallengesBtn = document.getElementById("goToChallenges");
if (goToChallengesBtn){
  goToChallengesBtn.disabled = false;
  goToChallengesBtn.addEventListener("click", () => {
    window.location.href = "retos.html";
  });
}

/* ================== RESET (mantener) ================== */
const resetAllBtn = document.getElementById("resetAllBtn");

let currentRotation = 0;
let spinning = false;

function resetAll() {
  localStorage.clear();

  currentRotation = 0;
  spinning = false;
  if (wheel) wheel.style.transform = "rotate(0deg)";

  setPoints(0);
  rewardsData = rewardsData || [];
  renderRewards();
  createWheelNumbers();

  showPopup("♻️ Todo reseteado: puntos, canjeos, codigos, y estado de ruleta.");
}

if (resetAllBtn) {
  resetAllBtn.addEventListener("click", () => {
    const ok = window.confirm("¿Seguro que quieres resetear TODO? (puntos, canjeadas, codigos, etc.)");
    if (ok) resetAll();
  });
}

/* ================== RULETA (LUNES Y MIERCOLES, 1 VEZ CADA DIA) ================== */
const wheelValues = [1, 4, 6, 0, 8, 4, 6, 1];
const wheel = document.getElementById("wheel");
const spinBtn = document.getElementById("spinBtn");

// Keys para recordar tiradas por dia habil
const WHEEL_MON_KEY = "wheel_spin_monday";
const WHEEL_WED_KEY = "wheel_spin_wednesday";

function isoDateLocal(d = new Date()){
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function canSpinNow(){
  const d = new Date();
  const day = d.getDay(); // 0 dom, 1 lun, 2 mar, 3 mie...
  const today = isoDateLocal(d);

  if (day !== 1 && day !== 3) {
    return { ok: false, reason: "⛔ La ruleta solo se puede tirar los lunes y los miercoles." };
  }

  if (day === 1) {
    const last = localStorage.getItem(WHEEL_MON_KEY);
    if (last === today) return { ok: false, reason: "⛔ Ya has tirado la ruleta hoy (lunes)." };
    return { ok: true, storeKey: WHEEL_MON_KEY, today };
  }

  // day === 3
  const last = localStorage.getItem(WHEEL_WED_KEY);
  if (last === today) return { ok: false, reason: "⛔ Ya has tirado la ruleta hoy (miercoles)." };
  return { ok: true, storeKey: WHEEL_WED_KEY, today };
}

/* numeros adheridos */
function createWheelNumbers() {
  if (!wheel) return;

  const sectors = wheelValues.length;
  const degreesPerSlice = 360 / sectors;

  wheel.querySelectorAll(".wheel-number").forEach(el => el.remove());

  const cs = getComputedStyle(wheel);
  const border = parseFloat(cs.borderTopWidth) || 0;
  const size = wheel.clientWidth;
  const radius = Math.max(60, size / 2 - border - 18);

  wheelValues.forEach((num, i) => {
    const span = document.createElement("span");
    span.className = "wheel-number";
    span.textContent = num;

    const angle = i * degreesPerSlice + degreesPerSlice / 2;

    span.style.transform = `
      translate(-50%, -50%)
      rotate(${angle}deg)
      translateY(-${radius}px)
    `;

    wheel.appendChild(span);
  });
}

window.addEventListener("resize", () => createWheelNumbers());
setTimeout(createWheelNumbers, 0);

/* girar */
if (spinBtn) {
  spinBtn.onclick = () => {
    if (spinning) return;

    const status = canSpinNow();
    if (!status.ok) {
      showPopup(status.reason);
      return;
    }

    spinning = true;

    const sectors = wheelValues.length;
    const degreesPerSlice = 360 / sectors;

    const index = Math.floor(Math.random() * sectors);
    const sliceCenter = index * degreesPerSlice + degreesPerSlice / 2;

    const normalized = ((currentRotation % 360) + 360) % 360;
    const extraSpins = 5 * 360;

    currentRotation = currentRotation - normalized + extraSpins - sliceCenter;
    wheel.style.transform = `rotate(${currentRotation}deg)`;

    setTimeout(() => {
      const pointsWon = wheelValues[index];

      // marca como usado HOY para el dia habil correspondiente
      localStorage.setItem(status.storeKey, status.today);

      setPoints(getPoints() + pointsWon);

      if (pointsWon > 0) celebrateWin();

      showPopup(pointsWon > 0
        ? `🎉 Has ganado ${pointsWon} puntos`
        : "😅 Ha salido 0 puntos. Mejor suerte la proxima."
      );

      spinning = false;
    }, 3600);
  };
}

/* ================== CANJEAR CÓDIGO ================== */
const USED_CODES_KEY = "usedCodes";
const codeInput = document.getElementById("codeInput");
const redeemCodeBtn = document.getElementById("redeemCodeBtn");

const CODES = {
  "GH10-A1B2": 10, "GH10-C3D4": 10, "GH10-E5F6": 10, "GH10-G7H8": 10,
  "GH10-I9J0": 10, "GH10-K1L2": 10, "GH10-M3N4": 10, "GH10-O5P6": 10,
  "GH15-Q7R8": 15, "GH15-S9T0": 15, "GH15-U1V2": 15, "GH15-W3X4": 15, "GH15-Y5Z6": 15,
  "GH18-AB12": 18, "GH18-CD34": 18, "GH18-EF56": 18,
  "GH22-GH78": 22, "GH22-IJ90": 22, "GH22-KL12": 22,
  "GH50-ULTRA": 50, "PIVI-2026":25
};

function normalizeCode(raw) {
  return (raw || "").trim().toUpperCase().replace(/[\s-]/g, "");
}

function getUsedCodes() {
  return JSON.parse(localStorage.getItem(USED_CODES_KEY)) || [];
}

function setUsedCodes(arr) {
  localStorage.setItem(USED_CODES_KEY, JSON.stringify(arr));
}

function findCodeValue(input) {
  const n = normalizeCode(input);
  for (const k in CODES) {
    if (normalizeCode(k) === n) return { value: CODES[k], key: n };
  }
  return null;
}

function redeemCode() {
  const found = findCodeValue(codeInput.value);
  if (!found) return showPopup("Codigo invalido ❌");

  const used = getUsedCodes();
  if (used.includes(found.key)) return showPopup("Ese codigo ya fue canjeado");

  setPoints(getPoints() + found.value);
  used.push(found.key);
  setUsedCodes(used);

  codeInput.value = "";

  celebrateWin();
  showPopup(`✅ Codigo canjeado: +${found.value} puntos`);
}

if (redeemCodeBtn) redeemCodeBtn.onclick = redeemCode;
if (codeInput) codeInput.addEventListener("keydown", e => e.key === "Enter" && redeemCode());

/* ================== INIT ================== */
setPoints(getPoints());

fetch("recompensas.json")
  .then(r => {
    if (!r.ok) throw new Error(`No se pudo cargar recompensas.json (${r.status})`);
    return r.json();
  })
  .then(data => {
    rewardsData = data;
    renderRewards();
    createWheelNumbers();
  })
  .catch(() => {
    showPopup("No se han podido cargar las recompensas (recompensas.json).");
    renderRewards();
  });
