const policy = window.PointsPolicy;
const GAME_ID = "atrapa";

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
const grid = document.getElementById("atrapaGrid");
const cells = [...grid.querySelectorAll(".atrapa-cell")];

const modeLabel = document.getElementById("modeLabel");
const timeLeftEl = document.getElementById("timeLeft");
const scoreEl = document.getElementById("score");
const rewardLabel = document.getElementById("rewardLabel");
const policyStatusEl = document.getElementById("policyStatus");
const timerFill = document.getElementById("timerFill");

const practiceBtn = document.getElementById("practiceBtn");
const challengeBtn = document.getElementById("challengeBtn");
const restartBtn = document.getElementById("restartBtn");
const stage = document.getElementById("stageTitle");

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
const DURATION = 30;           // segundos
const SPAWN_MS = 620;          // cada cuánto intenta aparecer un emoji
const LIFE_MS = 1100;          // cuánto dura visible
const MAX_ACTIVE = 3;          // emojis simultáneos
const BOMB_CHANCE = 0.18;      // probabilidad de bomba
const BOMB_PENALTY = 3;        // corazones que resta una bomba
const SCORE_DIV = 3;           // corazones por punto
const MAX_SCORE = 10;

/* ---------- estado ---------- */
let practiceMode = true;
let running = false;
let timeLeft = DURATION;
let score = 0;
let active = {};               // cellIndex -> { type, remove }
let gameTimer = null;
let spawnTimer = null;

function isChallengeRunning() { return running && !practiceMode; }
if (window.PiviCore && PiviCore.guardChallenge) PiviCore.guardChallenge(isChallengeRunning);

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

/* ---------- modales ---------- */
function openModal(t, x, againLabel) {
  modalTitle.textContent = t;
  modalText.textContent = x;
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
    ? "Elige modo. En Reto tienes 30 s: toca 💖 (suman) y evita 💣 (restan). 1 vez por fin de semana. Si sales a mitad, el reto se pierde."
    : st.reason + " Puedes practicar igualmente.";
  startOverlay.classList.remove("hidden");
}
function closeStartModal() { startOverlay.classList.add("hidden"); }
choosePractice.onclick = () => { closeStartModal(); startPractice(); };
chooseChallenge.onclick = () => { if (chooseChallenge.disabled) return; closeStartModal(); startChallenge(); };

/* ---------- UI ---------- */
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
  scoreEl.textContent = String(score);
  if (practiceMode && !running) { timeLeftEl.textContent = "∞"; timerFill.style.width = "0%"; return; }
  timeLeftEl.textContent = timeLeft + "s";
  timerFill.style.width = (clamp(timeLeft / DURATION, 0, 1) * 100) + "%";
}

/* ---------- spawn / tap ---------- */
function clearCell(i) {
  const a = active[i];
  if (a && a.remove) clearTimeout(a.remove);
  delete active[i];
  cells[i].textContent = "";
  cells[i].classList.remove("hit", "boom");
}
function spawn() {
  if (!running) return;
  if (Object.keys(active).length >= MAX_ACTIVE) return;
  const free = cells.map((_, i) => i).filter(i => !active[i]);
  if (!free.length) return;
  const i = free[Math.floor(Math.random() * free.length)];
  const type = Math.random() < BOMB_CHANCE ? "bomb" : "heart";
  cells[i].innerHTML = '<span class="target">' + (type === "bomb" ? "💣" : "💖") + "</span>";
  active[i] = { type: type, remove: setTimeout(() => clearCell(i), LIFE_MS) };
}
function tap(i) {
  if (!running) return;
  const a = active[i];
  if (!a) return;
  if (a.type === "heart") {
    score++;
    cells[i].classList.add("hit");
  } else {
    score = Math.max(0, score - BOMB_PENALTY);
    cells[i].classList.add("boom");
    grid.classList.add("shake");
    setTimeout(() => grid.classList.remove("shake"), 300);
  }
  if (a.remove) clearTimeout(a.remove);
  active[i] = { type: a.type, remove: setTimeout(() => clearCell(i), 160) };
  setStats();
}

/* ---------- bucle ---------- */
function stopLoops() {
  if (gameTimer) clearInterval(gameTimer);
  if (spawnTimer) clearInterval(spawnTimer);
  gameTimer = spawnTimer = null;
}
function clearBoard() { cells.forEach((_, i) => clearCell(i)); }

function startGame() {
  running = true;
  score = 0;
  timeLeft = DURATION;
  clearBoard();
  setStats();
  stage.textContent = practiceMode ? "¡A tocar corazones! 💖" : "Reto: ¡30 segundos!";
  stopLoops();
  spawnTimer = setInterval(spawn, SPAWN_MS);
  spawn();
  gameTimer = setInterval(() => {
    timeLeft--;
    setStats();
    if (timeLeft <= 0) finish();
  }, 1000);
}

function finish() {
  running = false;
  stopLoops();
  clearBoard();
  stage.textContent = "Tiempo 🏁";

  if (practiceMode) {
    openModal("✅ Fin (práctica)", `Has atrapado ${score} 💖.\n\nEn práctica no suma puntos.`);
    return;
  }
  const pts = clamp(Math.floor(score / SCORE_DIV), 0, MAX_SCORE);
  const res = policy?.awardWeekendChallengePoints
    ? policy.awardWeekendChallengePoints(pts, GAME_ID)
    : { ok: false, reason: "No se pudo aplicar la política.", gained: 0 };

  if (pts <= 0) {
    openModal("🏁 Fin del reto", `Corazones: ${score}.\n\nPocos para puntuar: 0 puntos.`);
  } else if (res.ok) {
    openModal("🏆 ¡Cazadora de corazones!", `Corazones: ${score}\n\nPuntos: +${res.gained}`);
    if (window.PiviCore) PiviCore.celebrate();
  } else {
    openModal("🏁 Fin del reto", `Corazones: ${score}\n\nNo puntúa: ${res.reason}`);
  }
  updatePolicyStatus();
}

/* ---------- modos ---------- */
function startPractice() {
  if (window.PiviCore && !PiviCore.confirmLeave()) return;
  practiceMode = true;
  setModeUI();
  startGame();
}
function startChallenge() {
  if (isChallengeRunning()) { PiviCore.toast("Ya estás jugando el reto 😉"); return; }
  const st = policy?.canPlayWeekendChallenge ? policy.canPlayWeekendChallenge(GAME_ID) : { ok: true, reason: "" };
  if (!st.ok) { openModal("⛔ No disponible", st.reason, "Practicar"); return; }
  practiceMode = false;
  policy?.markWeekendChallengePlayed?.(GAME_ID);
  setModeUI();
  startGame();
}
// "Reiniciar" / "Jugar otra": el reto solo se juega una vez, así que
// después (o desde práctica) siempre arranca una práctica
function restartSameMode(){
  if (isChallengeRunning()){ PiviCore.toast("🔒 El reto no se puede reiniciar"); return; }
  startPractice();
}

/* ---------- eventos ---------- */
cells.forEach((c, i) => {
  // al APOYAR el dedo: toques rápidos seguidos sin perder ninguno
  if (window.PiviCore && PiviCore.onTap) PiviCore.onTap(c, () => tap(i));
  else c.addEventListener("click", () => tap(i));
});
practiceBtn.onclick = startPractice;
challengeBtn.onclick = startChallenge;
restartBtn.onclick = restartSameMode;

/* ---------- INIT ---------- */
(function init() {
  running = false;
  score = 0;
  setModeUI();
  setStats();
  stage.textContent = "Elige un modo para empezar";
  modeLabel.textContent = "—";
  timeLeftEl.textContent = "—";
  updatePolicyStatus();
  openStartModal();
})();
