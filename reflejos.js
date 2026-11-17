const policy = window.PointsPolicy;
const GAME_ID = "reflejos";

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
const area = document.getElementById("reactArea");
const areaBig = document.getElementById("reactBig");
const areaSub = document.getElementById("reactSub");

const modeLabel = document.getElementById("modeLabel");
const roundEl = document.getElementById("round");
const lastEl = document.getElementById("last");
const avgEl = document.getElementById("avg");
const rewardLabel = document.getElementById("rewardLabel");
const policyStatusEl = document.getElementById("policyStatus");

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
const ROUNDS = 5;
const MAX_SCORE = 10;
const EARLY_MS = 700;          // penalización por tocar antes de tiempo
const MIN_WAIT = 1200, MAX_WAIT = 3500;

/* ---------- estado ---------- */
let practiceMode = true;
let state = "idle";            // idle | wait | go | result | early | done
let round = 0;
let times = [];
let goTime = 0;
let waitTimer = null;
let stepTimer = null;          // pausa entre rondas

function isChallengeRunning() { return !practiceMode && state !== "idle" && state !== "done"; }
if (window.PiviCore && PiviCore.guardChallenge) PiviCore.guardChallenge(isChallengeRunning);

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function avg(arr) { return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0; }

/* ---------- modales ---------- */
function openModal(title, text, againLabel) {
  modalTitle.textContent = title;
  modalText.textContent = text;
  // tras un reto (ya gastado) "Jugar otra" lleva a la práctica
  modalAgain.textContent = againLabel || (practiceMode ? "Jugar otra" : "Practicar");
  overlay.classList.remove("hidden");
}
function closeModal() { overlay.classList.add("hidden"); }
modalOk.onclick = closeModal;
modalAgain.onclick = () => { closeModal(); restartSameMode(); };

function updatePolicyStatus() {
  if (!policyStatusEl || !policy?.getWeekendRewardStatusText) return;
  policyStatusEl.textContent = policy.getWeekendRewardStatusText(GAME_ID);
}

/* ---------- start modal ---------- */
function openStartModal() {
  const st = policy?.canPlayWeekendChallenge ? policy.canPlayWeekendChallenge(GAME_ID) : { ok: true, reason: "" };
  chooseChallenge.disabled = !st.ok;
  chooseChallenge.title = st.ok ? "" : st.reason;
  startText.textContent = st.ok
    ? "Elige modo. En Reto haces 5 rondas: cuanto más rápida tu reacción media, más puntos (máx 10). 1 vez por fin de semana. Si sales a mitad, el reto se pierde."
    : st.reason + " Puedes practicar igualmente.";
  startOverlay.classList.remove("hidden");
}
function closeStartModal() { startOverlay.classList.add("hidden"); }
choosePractice.onclick = () => { closeStartModal(); startPractice(); };
chooseChallenge.onclick = () => { if (chooseChallenge.disabled) return; closeStartModal(); startChallenge(); };

/* ---------- UI ---------- */
function setArea(cls, big, sub) {
  area.className = "react-area " + cls;
  areaBig.textContent = big;
  areaSub.textContent = sub || "";
}
function setModeUI() {
  modeLabel.textContent = practiceMode ? "Práctica" : "Reto (+ puntos)";
  rewardLabel.textContent = practiceMode ? "—" : "Hasta +10";
  if (policy?.canPlayWeekendChallenge) {
    const st = policy.canPlayWeekendChallenge(GAME_ID);
    challengeBtn.disabled = !st.ok;
    challengeBtn.title = st.ok ? "" : st.reason;
  }
  updatePolicyStatus();
}
function setStats() {
  roundEl.textContent = round ? `${round}/${ROUNDS}` : "—";
  lastEl.textContent = times.length ? times[times.length - 1] + " ms" : "—";
  avgEl.textContent = times.length ? avg(times) + " ms" : "—";
}

/* ---------- rondas ---------- */
function clearWait() {
  if (waitTimer) clearTimeout(waitTimer);
  if (stepTimer) clearTimeout(stepTimer);
  waitTimer = stepTimer = null;
}

function beginRound() {
  state = "wait";
  setArea("wait", "Espera… 👀", "Toca cuando se ponga verde");
  setStats();
  const delay = MIN_WAIT + Math.random() * (MAX_WAIT - MIN_WAIT);
  clearWait();
  waitTimer = setTimeout(() => {
    state = "go";
    goTime = performance.now();
    setArea("go", "¡YA! 👆", "");
  }, delay);
}

function recordTime(ms) {
  times.push(ms);
  setStats();
}

function nextRound() {
  if (round >= ROUNDS) { finish(); return; }
  round++;
  setStats();
  beginRound();
}

function onAreaClick() {
  if (state === "wait") {
    // demasiado pronto
    clearWait();
    state = "early";
    recordTime(EARLY_MS);
    setArea("early", "❌ ¡Muy pronto!", `Cuenta como ${EARLY_MS} ms`);
    stepTimer = setTimeout(nextRound, 950);
  } else if (state === "go") {
    const ms = Math.round(performance.now() - goTime);
    state = "result";
    recordTime(ms);
    setArea("result", ms + " ms", reactionComment(ms));
    stepTimer = setTimeout(nextRound, 950);
  } else if (state === "idle" || state === "done") {
    /* nada: usa los botones de modo */
  }
}

function reactionComment(ms) {
  if (ms < 220) return "¡Reflejos de gato! 🐱";
  if (ms < 300) return "¡Muy rápido! ⚡";
  if (ms < 400) return "Bien 👍";
  if (ms < 550) return "Normalito";
  return "A despertar ☕";
}

function finish() {
  state = "done";
  clearWait();
  const media = avg(times);
  if (practiceMode) {
    openModal("✅ Fin (práctica)", `Reacción media: ${media} ms.\n\nEn práctica no suma puntos.`);
    setArea("idle", "Práctica terminada", "Pulsa Reiniciar para otra");
    return;
  }
  const pts = clamp(Math.round((600 - media) / 30), 0, MAX_SCORE);
  const res = policy?.awardWeekendChallengePoints
    ? policy.awardWeekendChallengePoints(pts, GAME_ID)
    : { ok: false, reason: "No se pudo aplicar la política.", gained: 0 };

  if (pts <= 0) {
    openModal("🏁 Fin del reto", `Media: ${media} ms.\n\nDemasiado lento para puntuar: 0 puntos.`);
  } else if (res.ok) {
    openModal("🏆 ¡Buenos reflejos!", `Reacción media: ${media} ms\n\nPuntos: +${res.gained}`);
    if (window.PiviCore) PiviCore.celebrate();
  } else {
    openModal("🏁 Fin del reto", `Media: ${media} ms\n\nNo puntúa: ${res.reason}`);
  }
  setArea("idle", "Reto terminado", `Media: ${media} ms`);
  updatePolicyStatus();
}

/* ---------- modos ---------- */
function resetRun() {
  clearWait();
  round = 0;
  times = [];
  state = "idle";
  setStats();
}
// Al pulsar "Empezar reto": ahora sí se gasta el intento del finde
function beginChallenge() {
  const st = policy?.canPlayWeekendChallenge ? policy.canPlayWeekendChallenge(GAME_ID) : { ok: true, reason: "" };
  if (!st.ok) { openModal("⛔ No disponible", st.reason, "Practicar"); return false; }
  policy?.markWeekendChallengePlayed?.(GAME_ID);
  updatePolicyStatus();
  return true;
}
function startPractice() {
  if (window.PiviCore && !PiviCore.confirmLeave()) return;
  practiceMode = true;
  resetRun();
  setModeUI();
  setArea("idle", "", "");
  PiviCore.readyGate(area, {
    label: "Empezar",
    hint: "5 rondas: toca en cuanto el panel se ponga verde",
    onStart: nextRound
  });
}
function startChallenge() {
  if (isChallengeRunning()) { PiviCore.toast("Ya estás jugando el reto 😉"); return; }
  const st = policy?.canPlayWeekendChallenge ? policy.canPlayWeekendChallenge(GAME_ID) : { ok: true, reason: "" };
  if (!st.ok) { openModal("⛔ No disponible", st.reason, "Practicar"); return; }
  practiceMode = false;
  resetRun();
  setModeUI();
  setArea("idle", "", "");
  PiviCore.readyGate(area, {
    label: "Empezar reto",
    hint: "Al pulsar, el reto cuenta (1 vez por finde). Cuanto más rápido, más puntos.",
    onBegin: beginChallenge,
    onStart: nextRound
  });
}
// "Reiniciar" / "Jugar otra": el reto solo se juega una vez, así que
// después (o desde práctica) siempre arranca una práctica
function restartSameMode(){
  if (isChallengeRunning()){ PiviCore.toast("🔒 El reto no se puede reiniciar"); return; }
  startPractice();
}

/* ---------- eventos ---------- */
// Al APOYAR el dedo (no al levantarlo): en el móvil es más justo y no se pierden toques.
if (window.PiviCore && PiviCore.onTap) PiviCore.onTap(area, onAreaClick);
else area.addEventListener("click", onAreaClick);
area.addEventListener("keydown", (e) => {
  if (e.target !== area) return; // p. ej. el botón "▶ Empezar" que va encima
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!e.repeat) onAreaClick(); }
});
practiceBtn.onclick = startPractice;
challengeBtn.onclick = startChallenge;
restartBtn.onclick = restartSameMode;

/* ---------- INIT ---------- */
(function init() {
  setModeUI();
  setStats();
  setArea("idle", "Elige un modo para empezar", "Toca cuando el panel se ponga verde");
  updatePolicyStatus();
  openStartModal();
})();
