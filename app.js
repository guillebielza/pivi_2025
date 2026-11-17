/* ============================================================
   app.js — Inicio: lo de hoy (ruleta, código, actividad) y un
   resumen de Premios y Recuerdos. El catálogo y los canjes viven
   en pivi-premios.js + premios.html; el histórico, en recuerdos.html.
   El confeti/sonido y el tema vienen de pivi-core.js (PiviCore/PiviFX).
   ============================================================ */

const recuerdosSubEl = document.getElementById("recuerdosSub");
const popupOverlay = document.getElementById("popupOverlay");
const popupText = document.getElementById("popupText");
const P = window.PiviPremios;

/* ================== STORAGE ================== */
function getPoints() { return Number(localStorage.getItem("points")) || 0; }
function setPoints(value) {
  const v = Number(value) || 0;
  localStorage.setItem("points", String(v));
  if (window.PiviCore && PiviCore.setPointsUI) PiviCore.setPointsUI(v, { bump: true });
  else { const el = document.getElementById("points"); if (el) el.textContent = String(v); }
  renderRewards();
}

/* ================== POPUP ================== */
function showPopup(text) {
  if (!popupText || !popupOverlay) return;
  popupText.textContent = text;
  popupOverlay.classList.remove("hidden");
}
const closePopupBtn = document.getElementById("closePopup");
if (closePopupBtn) closePopupBtn.onclick = () => popupOverlay.classList.add("hidden");
if (popupOverlay) popupOverlay.addEventListener("click", (e) => { if (e.target === popupOverlay) popupOverlay.classList.add("hidden"); });

/* ================== CELEBRACIÓN ================== */
function celebrateWin() {
  if (window.PiviCore && PiviCore.celebrate) PiviCore.celebrate({ duration: 2400 });
  else if (window.PiviFX && PiviFX.celebrate) PiviFX.celebrate();
}

function nowDate() { return (window.PiviClock && PiviClock.now) ? PiviClock.now() : new Date(); }
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ================== PREMIOS (solo el resumen) ================== */
// "Próximo premio" de la tira de estado + tarjeta de Premios + acceso a Recuerdos
function renderRewards() {
  updateNextReward();
  updatePremiosCard();
  updateRecuerdosCard();
}
window.renderRewards = renderRewards; // lo usan cloud-sync (al hidratar), el modo Dev y las correcciones

function updateNextReward() {
  const nameEl = document.getElementById("nextRewardName");
  const barEl = document.getElementById("nextRewardBar");
  const hintEl = document.getElementById("nextRewardHint");
  if (!nameEl || !barEl || !hintEl || !P || !P.all().length) return;
  const points = getPoints();
  const sig = P.siguiente();
  const res = P.resumen();
  if (sig) {
    nameEl.textContent = "¡sorpresa! 🎁"; // el título es secreto hasta canjearlo
    barEl.style.width = sig.pct + "%";
    hintEl.textContent = `Tienes ${points}/${sig.premio.coste} pts · te faltan ${sig.faltan}`;
  } else if (res.disponibles.length) {
    nameEl.textContent = "¡Te llega para cualquiera!";
    barEl.style.width = "100%";
    hintEl.textContent = `Tienes ${points} pts disponibles`;
  } else {
    nameEl.textContent = "—";
    barEl.style.width = "0%";
    hintEl.textContent = "Pronto habrá premios nuevos ✨";
  }
}

// Tarjeta de Premios: cuántos te llegan y unos pocos de muestra (siempre el mismo tamaño)
function updatePremiosCard() {
  const txt = document.getElementById("premiosResumen");
  const mini = document.getElementById("premiosMini");
  if (!txt || !mini || !P || !P.all().length) return;
  const points = getPoints();
  const res = P.resumen();
  const sig = P.siguiente();
  if (res.alcanzables.length) {
    const n = res.alcanzables.length;
    txt.innerHTML = `Con tus <b>${points} pts</b> te llega para <b>${n} ${n === 1 ? "premio" : "premios"}</b>.`;
  } else if (sig) {
    txt.innerHTML = `Te faltan <b>${sig.faltan} pts</b> para el próximo premio.`;
  } else {
    txt.textContent = "Ahora mismo no hay premios para canjear. ¡Pronto habrá sorpresas nuevas! ✨";
  }
  const muestra = (res.alcanzables.length ? res.alcanzables : res.disponibles).slice(0, 4);
  mini.innerHTML = muestra.map(r =>
    `<a class="reward${points >= r.coste ? " affordable" : ""}" href="premios.html" aria-label="Ver premios: sorpresa de ${r.coste} puntos">`
    + `<span class="emoji" aria-hidden="true">${esc(r.textoBoton)}</span><span class="cost">${r.coste} pts</span></a>`).join("");
  mini.classList.toggle("hidden", !muestra.length);
}

// Acceso a Recuerdos: cuántos hay y el último (el historial completo vive en recuerdos.html)
function updateRecuerdosCard() {
  if (!recuerdosSubEl || !window.PiviLedger || !PiviLedger.visibleCanjes) return;
  const list = PiviLedger.visibleCanjes();
  if (!list.length) { recuerdosSubEl.textContent = "Aquí se guardará todo lo que canjeéis 💞"; return; }
  const last = list[0];
  recuerdosSubEl.textContent = `${list.length} ${list.length === 1 ? "recuerdo" : "recuerdos"} · último: ${last.emoji} ${last.nombre}`;
}

/* ================== RULETA (LUN/MIÉ, 1/día) ================== */
let wheelValues = (window.PIVI_CONFIG && Array.isArray(PIVI_CONFIG.ruleta) && PIVI_CONFIG.ruleta.length)
  ? PIVI_CONFIG.ruleta : [1, 4, 6, 0, 8, 4, 6, 1];
const wheel = document.getElementById("wheel");
const spinBtn = document.getElementById("spinBtn");
const wheelHint = document.getElementById("wheelHint");

const WHEEL_MON_KEY = "wheel_spin_monday";
const WHEEL_WED_KEY = "wheel_spin_wednesday";

let currentRotation = 0;
let spinning = false;

function isoDateLocal(d = new Date()) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function canSpinNow() {
  const d = nowDate();
  const day = d.getDay();
  const today = isoDateLocal(d);
  if (window.PIVI_DEV_BYPASS) return { ok: true, today }; // sin storeKey -> no marca el candado
  if (day !== 1 && day !== 3) return { ok: false, reason: "⛔ La ruleta solo se puede tirar los lunes y los miércoles." };
  const key = day === 1 ? WHEEL_MON_KEY : WHEEL_WED_KEY;
  if (localStorage.getItem(key) === today) {
    return { ok: false, reason: `⛔ Ya has tirado la ruleta hoy (${day === 1 ? "lunes" : "miércoles"}).` };
  }
  return { ok: true, storeKey: key, today };
}

/* "Mañana, miércoles" / "Sábado, en 4 días": cuándo vuelve algo */
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
function nextDayOf(days, from = nowDate()) {
  for (let n = 1; n <= 7; n++) {
    const x = new Date(from); x.setDate(x.getDate() + n);
    if (days.includes(x.getDay())) return { n, name: DAY_NAMES[x.getDay()] };
  }
  return { n: 7, name: "" };
}
function whenText(next) {
  if (next.n === 1) return `Mañana, ${next.name}`;
  return `${next.name.charAt(0).toUpperCase()}${next.name.slice(1)}, en ${next.n} días`;
}

function updateWheelUI() {
  if (!spinBtn) return;
  const st = canSpinNow();
  const card = document.getElementById("wheelStatCard");
  const statusEl = document.getElementById("wheelStatus");
  const d = nowDate().getDay();
  const next = nextDayOf([1, 3]);
  const nextLong = next.n === 1 ? `mañana (${next.name})` : `el ${next.name} (en ${next.n} días)`;

  if (!spinning) spinBtn.disabled = !st.ok;
  spinBtn.title = st.ok ? "" : st.reason;

  if (statusEl) {
    if (st.ok) statusEl.textContent = "¡Disponible! 🎉";
    else if (d === 1 || d === 3) statusEl.textContent = "Hecha hoy ✅";
    else statusEl.textContent = whenText(next);
  }
  if (card) {
    card.classList.toggle("ok", st.ok);
    card.classList.toggle("locked", !st.ok);
  }
  if (wheelHint) {
    if (st.ok) wheelHint.textContent = "¡Hoy toca! 1 tirada (lunes y miércoles).";
    else if (d === 1 || d === 3) wheelHint.textContent = `Ya has tirado hoy. Próxima tirada: ${nextLong}.`;
    else wheelHint.textContent = `Se tira los lunes y miércoles. Próxima: ${nextLong}.`;
  }
}

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
    span.style.transform = `translate(-50%, -50%) rotate(${angle}deg) translateY(-${radius}px)`;
    wheel.appendChild(span);
  });
}
window.addEventListener("resize", createWheelNumbers);
setTimeout(createWheelNumbers, 0);

if (spinBtn) {
  spinBtn.onclick = () => {
    if (spinning) return;
    const status = canSpinNow();
    if (!status.ok) { showPopup(status.reason); return; }

    spinning = true;
    spinBtn.disabled = true;
    const sectors = wheelValues.length;
    const degreesPerSlice = 360 / sectors;
    const index = Math.floor(Math.random() * sectors);
    const pointsWon = wheelValues[index];

    // 1) El resultado se GUARDA YA (candado + puntos + registro): si se
    //    cierra la app mientras gira, la tirada cuenta y no se repite.
    //    La subida a la nube y el marcador esperan a que pare la ruleta.
    if (window.PiviSync && PiviSync.holdPush) PiviSync.holdPush(3900);
    if (status.storeKey) localStorage.setItem(status.storeKey, status.today); // en dev (bypass) no hay candado
    localStorage.setItem("points", String(getPoints() + pointsWon));
    if (window.PiviLedger) PiviLedger.record("wheel", pointsWon, pointsWon > 0 ? "Ruleta" : "Ruleta: sin premio", { silent: true });

    // 2) Animación
    const sliceCenter = index * degreesPerSlice + degreesPerSlice / 2;
    const normalized = ((currentRotation % 360) + 360) % 360;
    currentRotation = currentRotation - normalized + 5 * 360 - sliceCenter;
    wheel.style.transform = `rotate(${currentRotation}deg)`;

    setTimeout(() => {
      spinning = false;
      setPoints(getPoints()); // marcador con "bump"
      if (window.PiviLedger) { PiviLedger.render(); PiviLedger.renderStreak(); }

      if (pointsWon > 0) {
        celebrateWin();
        showPopup(`🎉 Has ganado ${pointsWon} ${pointsWon === 1 ? "punto" : "puntos"}`);
      } else {
        showPopup("😅 Ha salido 0 puntos. Mejor suerte la próxima.");
      }
      updateWheelUI();
    }, 3600);
  };
}

/* ================== RETOS (estado en home) ================== */
function updateWeekendUI() {
  const statusEl = document.getElementById("weekendStatus");
  const card = document.getElementById("weekendStatCard");
  if (!statusEl) return;
  const day = nowDate().getDay();
  const isWeekend = day === 6 || day === 0;
  let pending = isWeekend;
  if (isWeekend && window.PointsPolicy && PointsPolicy.weekendSummary) {
    const s = PointsPolicy.weekendSummary();
    pending = s.played < s.total;
    statusEl.textContent = pending ? `${s.played}/${s.total} hechos` : `¡${s.total}/${s.total}! 🎉`;
  } else {
    statusEl.textContent = isWeekend ? "¡Este finde! 🎮" : whenText(nextDayOf([6]));
  }
  if (card) { card.classList.toggle("ok", pending); card.classList.toggle("locked", !isWeekend); }
}

/* ================== CANJEAR CÓDIGO ================== */
const USED_CODES_KEY = "usedCodes";
const codeInput = document.getElementById("codeInput");
const redeemCodeBtn = document.getElementById("redeemCodeBtn");

// Los códigos viven en pivi-config.js (y se pueden editar en caliente)
function getCodes() {
  return (window.PIVI_CONFIG && PIVI_CONFIG.codigos) || { "GH50-ULTRA": 50, "PIVI-2026": 25 };
}

function normalizeCode(raw) { return (raw || "").trim().toUpperCase().replace(/[\s-]/g, ""); }
function getUsedCodes() { try { return JSON.parse(localStorage.getItem(USED_CODES_KEY)) || []; } catch (e) { return []; } }
function setUsedCodes(arr) { localStorage.setItem(USED_CODES_KEY, JSON.stringify(arr)); }
function findCodeValue(input) {
  const n = normalizeCode(input);
  const codes = getCodes();
  for (const k in codes) if (normalizeCode(k) === n) return { value: codes[k], key: n };
  return null;
}

// Avisos del código debajo del campo (sin ventana que haya que cerrar)
const codeHint = document.getElementById("codeHint");
const CODE_HINT_DEFAULT = codeHint ? codeHint.textContent : "";
function codeMessage(text, isError) {
  if (!codeHint) { showPopup(text); return; }
  codeHint.textContent = text || CODE_HINT_DEFAULT;
  codeHint.classList.toggle("error", !!isError);
  if (codeInput) {
    codeInput.setAttribute("aria-invalid", isError ? "true" : "false");
    if (isError) { codeInput.classList.remove("shake"); void codeInput.offsetWidth; codeInput.classList.add("shake"); }
  }
}

function redeemCode() {
  if (!codeInput.value.trim()) { codeMessage("Escribe un código primero ✍️", true); codeInput.focus(); return; }
  const found = findCodeValue(codeInput.value);
  if (!found) return codeMessage("Código inválido ❌ Revisa que esté bien escrito.", true);
  const used = getUsedCodes();
  if (used.includes(found.key)) return codeMessage("Ese código ya está canjeado 🙈", true);

  setPoints(getPoints() + found.value);
  used.push(found.key);
  setUsedCodes(used);
  codeInput.value = "";
  codeInput.blur(); // cierra el teclado del móvil
  codeMessage("");

  if (window.PiviLedger) PiviLedger.record("code", found.value, "Código canjeado");
  celebrateWin();
  showPopup(`✅ Código canjeado: +${found.value} puntos`);
}
if (redeemCodeBtn) redeemCodeBtn.onclick = redeemCode;
if (codeInput) {
  codeInput.addEventListener("keydown", e => { if (e.key === "Enter") redeemCode(); });
  codeInput.addEventListener("input", () => { if (codeHint && codeHint.classList.contains("error")) codeMessage(""); });
}

/* ================== INIT ================== */
if (window.PiviLedger) PiviLedger.renderStreak(); // "Esta semana: +X pts"
setPoints(getPoints());
updateWheelUI();
updateWeekendUI();

// Catálogo de premios (pivi-premios.js): al cargar y si cambia desde la nube
if (P) {
  P.onChange(() => { renderRewards(); });
  P.load().catch(() => { renderRewards(); });
}
window.addEventListener("pivi:canjes", updateRecuerdosCard);

// Cambios de contenido en caliente (códigos/ruleta/recompensas desde la nube)
window.addEventListener("pivi:config", () => {
  if (window.PIVI_CONFIG && Array.isArray(PIVI_CONFIG.ruleta) && PIVI_CONFIG.ruleta.length) wheelValues = PIVI_CONFIG.ruleta;
  createWheelNumbers();
  updateWheelUI();
});

// Al sincronizar desde la nube: refrescar puntos/estados
window.addEventListener("pivi:hydrated", () => {
  if (spinning) return; // no destapar el resultado mientras gira
  setPoints(getPoints());
  updateWheelUI();
  updateWeekendUI();
});
