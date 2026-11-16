/* ============================================================
   app.js — Página de inicio (recompensas, ruleta, códigos)
   El confeti/sonido y el tema vienen de pivi-core.js (PiviCore/PiviFX).
   El historial/feed y la racha vienen de pivi-ledger.js (PiviLedger).
   ============================================================ */

const experiencesEl = document.getElementById("experiences");
const giftsEl = document.getElementById("gifts");
const redeemedListEl = document.getElementById("redeemedList");
const popupOverlay = document.getElementById("popupOverlay");
const popupText = document.getElementById("popupText");

/* ================== STORAGE ================== */
function getPoints() { return Number(localStorage.getItem("points")) || 0; }
function setPoints(value) {
  const v = Number(value) || 0;
  localStorage.setItem("points", String(v));
  if (window.PiviCore && PiviCore.setPointsUI) PiviCore.setPointsUI(v, { bump: true });
  else { const el = document.getElementById("points"); if (el) el.textContent = String(v); }
  renderRewards();
}
function getRedeemed() { try { return JSON.parse(localStorage.getItem("redeemedRewards")) || []; } catch (e) { return []; } }
function setRedeemed(arr) { localStorage.setItem("redeemedRewards", JSON.stringify(arr)); }

/* ================== POPUP ================== */
function showPopup(text) {
  if (!popupText || !popupOverlay) return;
  popupText.textContent = text;
  popupOverlay.classList.remove("hidden");
}
const closePopupBtn = document.getElementById("closePopup");
if (closePopupBtn) closePopupBtn.onclick = () => popupOverlay.classList.add("hidden");
if (popupOverlay) popupOverlay.addEventListener("click", (e) => { if (e.target === popupOverlay) popupOverlay.classList.add("hidden"); });

/* ================== CONFIRMACIÓN ================== */
const confirmOverlay = document.getElementById("confirmOverlay");
const confirmText = document.getElementById("confirmText");
const confirmCancel = document.getElementById("confirmCancel");
const confirmOk = document.getElementById("confirmOk");
let pendingConfirm = null;

function closeConfirm() { if (confirmOverlay) confirmOverlay.classList.add("hidden"); pendingConfirm = null; }
function showConfirm(text, onOk) {
  if (!confirmOverlay || !confirmText) { if (window.confirm(text)) onOk(); return; }
  confirmText.textContent = text;
  pendingConfirm = onOk;
  confirmOverlay.classList.remove("hidden");
}
if (confirmCancel) confirmCancel.onclick = closeConfirm;
if (confirmOk) confirmOk.onclick = () => { const f = pendingConfirm; closeConfirm(); if (f) f(); };
if (confirmOverlay) confirmOverlay.addEventListener("click", (e) => { if (e.target === confirmOverlay) closeConfirm(); });

/* ================== CELEBRACIÓN ================== */
function celebrateWin() {
  if (window.PiviCore && PiviCore.celebrate) PiviCore.celebrate({ duration: 2400 });
  else if (window.PiviFX && PiviFX.celebrate) PiviFX.celebrate();
}

/* ================== RECOMPENSAS ================== */
let rewardsData = [];

function nowDate() { return (window.PiviClock && PiviClock.now) ? PiviClock.now() : new Date(); }
function isAvailable(reward) {
  if (window.PIVI_DEV_FORCE_AVAILABLE) return true; // modo dev: todo disponible
  return reward && reward.disponible !== false;
}
function rewardName(r) {
  if (r.mensajeHistorico) return r.mensajeHistorico.split("—")[0].trim();
  return (r.tipo || "Recompensa") + " de " + r.coste + " pts";
}

function makeRewardTile(r) {
  const btn = document.createElement("button");
  btn.className = "reward";
  btn.type = "button";
  btn.innerHTML = `<span class="emoji" aria-hidden="true">${r.textoBoton}</span><span class="cost">${r.coste} pts</span>`;

  const redeemed = getRedeemed().includes(r.id);
  const available = isAvailable(r);
  const points = getPoints();

  if (redeemed) {
    btn.classList.add("redeemed");
    btn.disabled = true;
    btn.setAttribute("aria-label", `${rewardName(r)} — ya canjeada`); // ya desbloqueada: se puede revelar
  } else if (!available) {
    btn.classList.add("unavailable");
    btn.disabled = true;
    btn.setAttribute("aria-label", `Recompensa sorpresa de ${r.coste} puntos — próximamente`);
  } else {
    btn.setAttribute("aria-label", `Canjear recompensa sorpresa por ${r.coste} puntos`); // sorpresa hasta canjear
    if (points >= r.coste) btn.classList.add("affordable");
    btn.onclick = () => askRedeem(r.id);
  }
  return btn;
}

function renderRewards() {
  if (!experiencesEl || !giftsEl) return;
  experiencesEl.innerHTML = "";
  giftsEl.innerHTML = "";
  if (redeemedListEl) redeemedListEl.innerHTML = "";

  const redeemed = getRedeemed();

  rewardsData.forEach((r) => {
    (r.tipo === "Experiencia" ? experiencesEl : giftsEl).appendChild(makeRewardTile(r));
    if (redeemed.includes(r.id) && r.mensajeHistorico && redeemedListEl) {
      const li = document.createElement("li");
      li.textContent = r.mensajeHistorico;
      redeemedListEl.appendChild(li);
    }
  });

  if (redeemedListEl && !redeemedListEl.children.length) {
    redeemedListEl.innerHTML = '<li class="muted">Aún no has canjeado nada.</li>';
  }

  updateNextReward();
}

function updateNextReward() {
  const nameEl = document.getElementById("nextRewardName");
  const barEl = document.getElementById("nextRewardBar");
  const hintEl = document.getElementById("nextRewardHint");
  if (!nameEl || !barEl || !hintEl) return;

  const points = getPoints();
  const redeemed = getRedeemed();
  const candidates = rewardsData.filter(r => isAvailable(r) && !redeemed.includes(r.id));
  const locked = candidates.filter(r => r.coste > points).sort((a, b) => a.coste - b.coste);

  if (locked.length) {
    const next = locked[0];
    nameEl.textContent = "¡sorpresa! 🎁"; // el título es secreto hasta desbloquearla
    const pct = Math.max(4, Math.min(100, (points / next.coste) * 100));
    barEl.style.width = pct + "%";
    hintEl.textContent = `Tienes ${points}/${next.coste} pts · te faltan ${next.coste - points}`;
  } else if (candidates.length) {
    nameEl.textContent = "¡Puedes canjear lo que quieras!";
    barEl.style.width = "100%";
    hintEl.textContent = `Tienes ${points} pts disponibles`;
  } else {
    nameEl.textContent = "—";
    barEl.style.width = "0%";
    hintEl.textContent = "No hay recompensas disponibles ahora mismo";
  }
}

// Paso intermedio: pide confirmación antes de canjear (no revela el título)
function askRedeem(rewardId) {
  const reward = rewardsData.find(r => r.id === rewardId);
  if (!reward) return;
  if (!isAvailable(reward)) return showPopup("⛔ Esta recompensa no está disponible ahora mismo.");
  const points = getPoints();
  if (points < reward.coste) return showPopup(`Te faltan ${reward.coste - points} puntos para esto.`);
  showConfirm(
    `¿Seguro que quieres canjear ${reward.textoBoton} por ${reward.coste} puntos?\n\nTe quedarán ${points - reward.coste} puntos.`,
    () => redeemReward(rewardId)
  );
}

function redeemReward(rewardId) {
  const reward = rewardsData.find(r => r.id === rewardId);
  if (!reward) return showPopup("Ha ocurrido un error: recompensa no encontrada.");
  if (!isAvailable(reward)) return showPopup("⛔ Esta recompensa no está disponible ahora mismo.");

  const points = getPoints();
  if (points < reward.coste) return showPopup(`Te faltan ${reward.coste - points} puntos para esto.`);

  setPoints(points - reward.coste);
  const redeemed = getRedeemed();
  redeemed.push(reward.id);
  setRedeemed(redeemed);

  if (window.PiviLedger) PiviLedger.record("reward", -reward.coste, "Canje: " + rewardName(reward));

  // celebración especial: confeti + emoji gigante + fanfarria, y el mensaje tras el "pop"
  if (window.PiviCore && PiviCore.celebrateReward) PiviCore.celebrateReward(reward.textoBoton);
  else celebrateWin();
  setTimeout(() => showPopup(reward.mensajePopup || "✅ Recompensa canjeada"), 650);
  renderRewards();
}
window.renderRewards = renderRewards; // lo usa cloud-sync al hidratar

/* ================== RETOS ================== */
const goToChallengesBtn = document.getElementById("goToChallenges");
if (goToChallengesBtn) goToChallengesBtn.addEventListener("click", () => window.location.href = "retos.html");

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

function updateWheelUI() {
  if (!spinBtn) return;
  const st = canSpinNow();
  const card = document.getElementById("wheelStatCard");
  const statusEl = document.getElementById("wheelStatus");
  const d = nowDate().getDay();

  spinBtn.disabled = !st.ok;
  spinBtn.title = st.ok ? "" : st.reason;

  if (statusEl) {
    if (st.ok) statusEl.textContent = "¡Disponible! 🎉";
    else if (d === 1 || d === 3) statusEl.textContent = "Ya tirada hoy ✅";
    else statusEl.textContent = "Vuelve lun/mié";
  }
  if (card) {
    card.classList.toggle("ok", st.ok);
    card.classList.toggle("locked", !st.ok);
  }
  if (wheelHint && !st.ok && (d === 1 || d === 3)) wheelHint.textContent = "Ya has tirado hoy. Vuelve el próximo día hábil.";
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
    const sliceCenter = index * degreesPerSlice + degreesPerSlice / 2;
    const normalized = ((currentRotation % 360) + 360) % 360;
    currentRotation = currentRotation - normalized + 5 * 360 - sliceCenter;
    wheel.style.transform = `rotate(${currentRotation}deg)`;

    setTimeout(() => {
      const pointsWon = wheelValues[index];
      if (status.storeKey) localStorage.setItem(status.storeKey, status.today); // en dev (bypass) no hay candado
      setPoints(getPoints() + pointsWon);

      if (pointsWon > 0) {
        if (window.PiviLedger) PiviLedger.record("wheel", pointsWon, "Ruleta");
        celebrateWin();
        showPopup(`🎉 Has ganado ${pointsWon} puntos`);
      } else {
        if (window.PiviLedger) PiviLedger.record("wheel", 0, "Ruleta: sin premio");
        showPopup("😅 Ha salido 0 puntos. Mejor suerte la próxima.");
      }
      spinning = false;
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
  statusEl.textContent = isWeekend ? "¡Activos este finde! 🎮" : "Vuelven el sábado";
  if (card) { card.classList.toggle("ok", isWeekend); card.classList.toggle("locked", !isWeekend); }
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

function redeemCode() {
  const found = findCodeValue(codeInput.value);
  if (!found) return showPopup("Código inválido ❌");
  const used = getUsedCodes();
  if (used.includes(found.key)) return showPopup("Ese código ya fue canjeado.");

  setPoints(getPoints() + found.value);
  used.push(found.key);
  setUsedCodes(used);
  codeInput.value = "";

  if (window.PiviLedger) PiviLedger.record("code", found.value, "Código canjeado");
  celebrateWin();
  showPopup(`✅ Código canjeado: +${found.value} puntos`);
}
if (redeemCodeBtn) redeemCodeBtn.onclick = redeemCode;
if (codeInput) codeInput.addEventListener("keydown", e => { if (e.key === "Enter") redeemCode(); });

/* ================== INIT ================== */
if (window.PiviLedger) PiviLedger.touchStreak();
setPoints(getPoints());
updateWheelUI();
updateWeekendUI();

// Aplica los ajustes de recompensas definidos en pivi-config.js (override por id)
function applyRewardOverrides() {
  const ov = (window.PIVI_CONFIG && PIVI_CONFIG.recompensasOverride) || {};
  rewardsData.forEach(r => { const o = ov[String(r.id)]; if (o) Object.assign(r, o); });
}

fetch("recompensas.json", { cache: "no-cache" })
  .then(r => { if (!r.ok) throw new Error(`recompensas.json (${r.status})`); return r.json(); })
  .then(data => { rewardsData = data; applyRewardOverrides(); renderRewards(); createWheelNumbers(); })
  .catch(() => { showPopup("No se han podido cargar las recompensas (recompensas.json)."); renderRewards(); });

// Cambios de contenido en caliente (códigos/ruleta/recompensas desde la nube)
window.addEventListener("pivi:config", () => {
  if (window.PIVI_CONFIG && Array.isArray(PIVI_CONFIG.ruleta) && PIVI_CONFIG.ruleta.length) wheelValues = PIVI_CONFIG.ruleta;
  applyRewardOverrides();
  renderRewards();
  createWheelNumbers();
  updateWheelUI();
});

// Al sincronizar desde la nube: refrescar puntos/estados
window.addEventListener("pivi:hydrated", () => {
  setPoints(getPoints());
  updateWheelUI();
  updateWeekendUI();
});
