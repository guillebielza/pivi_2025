const policy = window.PointsPolicy;
const GAME_ID = "simon";

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
const board = document.getElementById("simonBoard");
const pads = [...board.querySelectorAll(".pad")];
const stage = document.getElementById("stageTitle");

const modeLabel = document.getElementById("modeLabel");
const roundEl = document.getElementById("round");
const timeLeftEl = document.getElementById("timeLeft");
const rewardLabel = document.getElementById("rewardLabel");
const policyStatusEl = document.getElementById("policyStatus");
const timerFill = document.getElementById("timerFill");
const toastEl = document.getElementById("toast");

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
const PADS = 4;
const MAX_SCORE = 10;          // tope de puntos en reto
const ANSWER_SECONDS = 5;      // ventana por toque (reto)

/* ---------- estado ---------- */
let practiceMode = true;
let sequence = [];
let inputIndex = 0;
let acceptingInput = false;
let level = 0;                 // rondas completadas
let timerId = null;
let timeLeft = ANSWER_SECONDS;

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

/* ---------- sonido (un tono por pad) ---------- */
let actx = null;
const TONES = [329.63, 261.63, 220.0, 392.0]; // E4, C4, A3, G4
function tone(i, dur) {
  dur = dur || 0.3;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = "sine";
    o.frequency.value = TONES[i] || 330;
    g.gain.setValueAtTime(0.0001, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, actx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(); o.stop(actx.currentTime + dur + 0.03);
  } catch (e) { /* sin sonido */ }
}

/* ---------- util UI ---------- */
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  setTimeout(() => toastEl.classList.add("hidden"), 1200);
}
function openModal(title, text) {
  modalTitle.textContent = title;
  modalText.textContent = text;
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
    ? "Elige modo. En Reto ganas 1 punto por ronda superada (máx 10). Solo 1 vez por fin de semana."
    : st.reason + " Puedes practicar igualmente.";
  startOverlay.classList.remove("hidden");
}
function closeStartModal() { startOverlay.classList.add("hidden"); }
choosePractice.onclick = () => { closeStartModal(); startPractice(); };
chooseChallenge.onclick = () => { if (chooseChallenge.disabled) return; closeStartModal(); startChallenge(); };

/* ---------- modo / stats ---------- */
function setModeUI() {
  modeLabel.textContent = practiceMode ? "Práctica" : "Reto (+ puntos)";
  rewardLabel.textContent = practiceMode ? "—" : "1 pt / ronda (máx 10)";
  if (policy?.canPlayWeekendChallenge) {
    const st = policy.canPlayWeekendChallenge(GAME_ID);
    challengeBtn.disabled = !st.ok;
    challengeBtn.title = st.ok ? "" : st.reason;
  }
  updatePolicyStatus();
}
function setRoundUI() {
  roundEl.textContent = sequence.length ? String(sequence.length) : "—";
  setTimerUI();
}
function setTimerUI() {
  if (practiceMode) { timeLeftEl.textContent = "∞"; timerFill.style.width = "0%"; return; }
  timeLeftEl.textContent = timeLeft + "s";
  timerFill.style.width = (clamp(timeLeft / ANSWER_SECONDS, 0, 1) * 100) + "%";
}

/* ---------- timer (solo reto, por toque) ---------- */
function stopTimer() { if (timerId) clearInterval(timerId); timerId = null; }
function startAnswerTimer() {
  if (practiceMode) return;
  stopTimer();
  timeLeft = ANSWER_SECONDS;
  setTimerUI();
  timerId = setInterval(() => {
    timeLeft--;
    setTimerUI();
    if (timeLeft <= 0) {
      stopTimer();
      if (acceptingInput) { acceptingInput = false; toast("⏱️ ¡Tiempo!"); fail(); }
    }
  }, 1000);
}
function restartAnswerTimer() { if (!practiceMode) startAnswerTimer(); }

/* ---------- pads ---------- */
function setPadsEnabled(on) { board.classList.toggle("locked", !on); }
function flash(i, dur) {
  dur = dur || 420;
  const p = pads[i];
  if (!p) return;
  p.classList.add("lit");
  tone(i, dur / 1000);
  setTimeout(() => p.classList.remove("lit"), dur);
}

/* ---------- reproducción de la secuencia ---------- */
function speed() { return Math.max(230, 620 - level * 28); } // más rápido cada ronda
function playSequence() {
  acceptingInput = false;
  setPadsEnabled(false);
  stage.textContent = "Observa… 👀";
  const gap = speed();
  const litMs = Math.max(240, gap - 130);
  let i = 0;
  function step() {
    if (i >= sequence.length) {
      stage.textContent = "¡Tu turno! 🎯";
      inputIndex = 0;
      acceptingInput = true;
      setPadsEnabled(true);
      startAnswerTimer();
      return;
    }
    flash(sequence[i], litMs);
    i++;
    setTimeout(step, gap);
  }
  setTimeout(step, 550);
}

function nextRound() {
  sequence.push(Math.floor(Math.random() * PADS));
  setRoundUI();
  playSequence();
}

function onPad(i) {
  if (!acceptingInput) return;
  flash(i, 250);

  if (i === sequence[inputIndex]) {
    inputIndex++;
    restartAnswerTimer();
    if (inputIndex >= sequence.length) {
      // ronda superada
      level++;
      acceptingInput = false;
      stopTimer();
      setPadsEnabled(false);
      setRoundUI();
      stage.textContent = "✅ ¡Bien! Ronda " + level + " superada";
      setTimeout(nextRound, 750);
    }
  } else {
    fail();
  }
}

function fail() {
  acceptingInput = false;
  stopTimer();
  setPadsEnabled(false);
  board.classList.add("wrong");
  setTimeout(() => board.classList.remove("wrong"), 450);
  finish();
}

function finish() {
  if (practiceMode) {
    openModal("✅ Fin (práctica)", `Rondas superadas: ${level}.\n\nEn práctica no suma puntos. ¡Otra vez!`);
    return;
  }
  const pts = clamp(level, 0, MAX_SCORE);
  if (pts <= 0) {
    openModal("🏁 Fin del reto", "No superaste ninguna ronda.\n\nPuntos: 0");
    updatePolicyStatus();
    return;
  }
  const res = policy?.awardWeekendChallengePoints
    ? policy.awardWeekendChallengePoints(pts, GAME_ID)
    : { ok: false, reason: "No se pudo aplicar la política.", gained: 0 };

  if (res.ok) {
    openModal("🏆 ¡Buena memoria!", `Rondas superadas: ${level}\n\nPuntos: +${res.gained}`);
    if (window.PiviCore) PiviCore.celebrate();
  } else {
    openModal("🏁 Fin del reto", `Rondas: ${level}\n\nNo puntúa: ${res.reason}`);
  }
  updatePolicyStatus();
}

/* ---------- modos ---------- */
function resetState() {
  stopTimer();
  sequence = [];
  inputIndex = 0;
  level = 0;
  acceptingInput = false;
  setPadsEnabled(false);
  pads.forEach(p => p.classList.remove("lit"));
  setRoundUI();
}
function startPractice() {
  practiceMode = true;
  resetState();
  setModeUI();
  stage.textContent = "Práctica: observa y repite";
  setTimeout(nextRound, 400);
}
function startChallenge() {
  const st = policy?.canPlayWeekendChallenge ? policy.canPlayWeekendChallenge(GAME_ID) : { ok: true, reason: "" };
  if (!st.ok) { openModal("⛔ No disponible", st.reason); return; }
  practiceMode = false;
  policy?.markWeekendChallengePlayed?.(GAME_ID);
  resetState();
  setModeUI();
  stage.textContent = "Reto: observa y repite";
  setTimeout(nextRound, 400);
}
function restartSameMode() { if (practiceMode) startPractice(); else startChallenge(); }

/* ---------- eventos ---------- */
pads.forEach((p, i) => p.addEventListener("click", () => onPad(i)));
document.addEventListener("keydown", (e) => {
  if (e.key >= "1" && e.key <= "4") onPad(Number(e.key) - 1);
});
practiceBtn.onclick = startPractice;
challengeBtn.onclick = startChallenge;
restartBtn.onclick = restartSameMode;

/* ---------- INIT ---------- */
(function init() {
  modeLabel.textContent = "—";
  rewardLabel.textContent = "—";
  roundEl.textContent = "—";
  timeLeftEl.textContent = "—";
  timerFill.style.width = "0%";
  stage.textContent = "Elige un modo para empezar";
  setPadsEnabled(false);
  setModeUI();
  updatePolicyStatus();
  openStartModal();
})();
