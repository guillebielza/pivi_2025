const policy = window.PointsPolicy;
const GAME_ID = "missing";

/* ---------- puntos UI ---------- */
const pointsEl = document.getElementById("points");
function getPoints(){ return Number(localStorage.getItem("points")) || 0; }
function setPoints(v){
  const n = Number(v) || 0;
  localStorage.setItem("points", String(n));
  if (pointsEl) pointsEl.textContent = String(n);
}
setPoints(getPoints());

/* ---------- DOM ---------- */
const modeLabel = document.getElementById("modeLabel");
const roundEl = document.getElementById("round");
const roundsTotalEl = document.getElementById("roundsTotal");
const timeLeftEl = document.getElementById("timeLeft");
const correctEl = document.getElementById("correct");
const wrongEl = document.getElementById("wrong");
const rewardLabel = document.getElementById("rewardLabel");

const timerFill = document.getElementById("timerFill");
const stageTitle = document.getElementById("stageTitle");
const gridEl = document.getElementById("grid");
const choicesEl = document.getElementById("choices");
const toastEl = document.getElementById("toast");

const practiceBtn = document.getElementById("practiceBtn");
const challengeBtn = document.getElementById("challengeBtn");
const restartBtn = document.getElementById("restartBtn");
const giveUpBtn = document.getElementById("giveUpBtn");

const overlay = document.getElementById("overlay");
const modalTitle = document.getElementById("modalTitle");
const modalText = document.getElementById("modalText");
const modalOk = document.getElementById("modalOk");
const modalAgain = document.getElementById("modalAgain");

const startOverlay = document.getElementById("startOverlay");
const startText = document.getElementById("startText");
const choosePractice = document.getElementById("choosePractice");
const chooseChallenge = document.getElementById("chooseChallenge");

const policyStatusEl = document.getElementById("policyStatus");

/* ---------- estado ---------- */
let practiceMode = true;
let timerId = null;

const ROUNDS_TOTAL = 10;

/* ✅ más tiempo antes de que desaparezcan (lo pediste) */
const SHOW_MS = 2200;    // antes 1600
const HIDE_MS = 750;     // un pelín más suave

const ANSWER_SECONDS = 7; // un poco más de margen en reto
let timeLeft = ANSWER_SECONDS;

let round = 1;
let correct = 0;
let wrong = 0;

let currentSet = [];
let missingIcon = null;
let accepting = false;

const ICONS = [
  "🍕","🍣","🍩","🍔","🍟","🌮","🍿","🍪","🍦","🍫",
  "🍇","🍉","🍓","🍒","🥝","🍍","🥑","🥨","🧀","🍗",
  "🐶","🐱","🐼","🦊","🐸","🦄","🐵","🐙","🦋","🌈",
  "⚽","🏀","🎾","🎸","🎧","🎮","🚗","✈️","🚀","🏝️"
];

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

/* ---------- UI helpers ---------- */
function updatePolicyStatus(){
  if (!policyStatusEl || !policy?.getWeekendRewardStatusText) return;
  policyStatusEl.textContent = policy.getWeekendRewardStatusText(GAME_ID);
}

function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  setTimeout(() => toastEl.classList.add("hidden"), 1200);
}

function openModal(title, text){
  modalTitle.textContent = title;
  modalText.textContent = text;
  overlay.classList.remove("hidden");
}
function closeModal(){ overlay.classList.add("hidden"); }
modalOk.onclick = closeModal;

modalAgain.onclick = () => {
  closeModal();
  restartSameMode();
};

/* ---------- start modal ---------- */
function openStartModal(){
  const st = policy?.canPlayWeekendChallenge ? policy.canPlayWeekendChallenge(GAME_ID) : { ok: true, reason: "" };

  chooseChallenge.disabled = !st.ok;
  chooseChallenge.title = st.ok ? "" : st.reason;

  startText.textContent = st.ok
    ? "Elige modo. En Reto ganas 1 punto por acierto (máx 10). Solo 1 vez por fin de semana para este juego."
    : st.reason + " Puedes practicar igualmente.";

  startOverlay.classList.remove("hidden");
}
function closeStartModal(){ startOverlay.classList.add("hidden"); }

choosePractice.onclick = () => { closeStartModal(); startPractice(); };
chooseChallenge.onclick = () => {
  if (chooseChallenge.disabled) return;
  closeStartModal();
  startChallenge();
};

/* ---------- modo / stats ---------- */
function setModeUI(){
  modeLabel.textContent = practiceMode ? "Práctica" : "Reto (+ puntos)";
  rewardLabel.textContent = practiceMode ? "—" : "1 pt / acierto";

  if (policy?.canPlayWeekendChallenge){
    const st = policy.canPlayWeekendChallenge(GAME_ID);
    challengeBtn.disabled = !st.ok;
    challengeBtn.title = st.ok ? "" : st.reason;
  }
  updatePolicyStatus();
}

function setStatsUI(){
  roundsTotalEl.textContent = String(ROUNDS_TOTAL);
  roundEl.textContent = String(round);
  correctEl.textContent = String(correct);
  wrongEl.textContent = String(wrong);

  if (practiceMode){
    timeLeftEl.textContent = "∞";
    timerFill.style.width = "0%";
  } else {
    timeLeftEl.textContent = `${timeLeft}s`;
    timerFill.style.width = `${clamp(timeLeft / ANSWER_SECONDS, 0, 1) * 100}%`;
  }
}

/* ---------- timer ---------- */
function stopTimer(){
  if (timerId) clearInterval(timerId);
  timerId = null;
}
function startAnswerTimer(){
  stopTimer();
  timeLeft = ANSWER_SECONDS;
  setStatsUI();

  timerId = setInterval(() => {
    timeLeft--;
    setStatsUI();
    if (timeLeft <= 0){
      stopTimer();
      accepting = false;
      wrong++;
      toast("⏱️ Tiempo!");
      endRound();
    }
  }, 1000);
}

/* ---------- lógica del juego ---------- */
function sampleUniqueIcons(n){
  const pool = [...ICONS];
  const out = [];
  while (out.length < n && pool.length){
    const i = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

function renderGrid(icons, hideOne = false){
  gridEl.innerHTML = "";
  icons.forEach((ic) => {
    const d = document.createElement("div");
    d.className = "icon";
    d.textContent = ic;
    if (hideOne && ic === missingIcon) d.classList.add("hidden");
    gridEl.appendChild(d);
  });
}

function shuffleOptions(arr){
  for (let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function renderChoices(options){
  choicesEl.innerHTML = "";
  options.forEach((ic) => {
    const b = document.createElement("button");
    b.className = "choice";
    b.textContent = ic;
    b.onclick = () => onChoose(b, ic);
    choicesEl.appendChild(b);
  });
}

function setChoicesEnabled(enabled){
  choicesEl.querySelectorAll("button.choice").forEach(b => b.disabled = !enabled);
}

function startRound(){
  accepting = false;
  setStatsUI();
  stageTitle.textContent = `Ronda ${round}: memoriza…`;

  currentSet = sampleUniqueIcons(9);
  missingIcon = currentSet[Math.floor(Math.random() * currentSet.length)];

  renderGrid(currentSet, false);
  renderChoices([]);
  setChoicesEnabled(false);

  setTimeout(() => {
    stageTitle.textContent = "… y ahora falta uno";
    renderGrid(currentSet, true);

    setTimeout(() => {
      stageTitle.textContent = "Elige cuál falta";
      const options = shuffleOptions([missingIcon, ...sampleUniqueIcons(3)]);
      renderChoices(options);
      accepting = true;
      setChoicesEnabled(true);

      if (!practiceMode) startAnswerTimer();
      else { timeLeftEl.textContent = "∞"; timerFill.style.width = "0%"; }
    }, HIDE_MS);
  }, SHOW_MS);
}

function onChoose(btn, icon){
  if (!accepting) return;
  accepting = false;

  stopTimer();
  setChoicesEnabled(false);

  const buttons = [...choicesEl.querySelectorAll(".choice")];
  buttons.forEach(b => b.classList.add("neutral"));

  if (icon === missingIcon){
    correct++;
    btn.classList.remove("neutral");
    btn.classList.add("correct");
    toast("✅ Correcto!");
  } else {
    wrong++;
    btn.classList.remove("neutral");
    btn.classList.add("wrong");

    const correctBtn = buttons.find(b => b.textContent === missingIcon);
    if (correctBtn){
      correctBtn.classList.remove("neutral");
      correctBtn.classList.add("correct");
    }
    toast("❌ Fallo!");
  }

  endRound();
}

function endRound(){
  setStatsUI();
  setTimeout(() => {
    if (round >= ROUNDS_TOTAL) finishGame();
    else { round++; startRound(); }
  }, 650);
}

function finishGame(){
  stopTimer();
  setChoicesEnabled(false);

  if (practiceMode){
    openModal("✅ Fin (práctica)", `Aciertos: ${correct}\nFallos: ${wrong}\n\nEn práctica no suma puntos.`);
    return;
  }

  // 1 punto por acierto (máx 10)
  const pointsToGive = clamp(correct, 0, ROUNDS_TOTAL);

  const res = policy?.awardWeekendChallengePoints
    ? policy.awardWeekendChallengePoints(pointsToGive, GAME_ID)
    : { ok: false, reason: "No se pudo aplicar la política.", gained: 0 };

  if (res.ok){
    openModal("🏆 ¡Reto completado!", `Puntos: +${res.gained}\n\nAciertos: ${correct}\nFallos: ${wrong}`);
  } else {
    openModal("🏁 Reto completado", `Has terminado, pero no puntúa: ${res.reason}`);
  }

  updatePolicyStatus();
}

function resetGameState(){
  stopTimer();
  round = 1;
  correct = 0;
  wrong = 0;
  accepting = false;
  currentSet = [];
  missingIcon = null;
  gridEl.innerHTML = "";
  choicesEl.innerHTML = "";
}

/* ---------- modos ---------- */
function startPractice(){
  practiceMode = true;
  resetGameState();
  setModeUI();
  setStatsUI();
  stageTitle.textContent = "Práctica: empieza la ronda 1";
  startRound();
}

function startChallenge(){
  const st = policy?.canPlayWeekendChallenge ? policy.canPlayWeekendChallenge(GAME_ID) : { ok: true, reason: "" };
  if (!st.ok){
    openModal("⛔ No disponible", st.reason);
    return;
  }

  practiceMode = false;
  policy?.markWeekendChallengePlayed?.(GAME_ID);

  resetGameState();
  setModeUI();
  setStatsUI();
  stageTitle.textContent = "Reto: empieza la ronda 1";
  startRound();
}

function restartSameMode(){
  if (practiceMode) startPractice();
  else startChallenge();
}

/* ---------- botones ---------- */
practiceBtn.onclick = startPractice;
challengeBtn.onclick = startChallenge;
restartBtn.onclick = restartSameMode;

giveUpBtn.onclick = () => {
  stopTimer();
  accepting = false;

  if (!practiceMode){
    openModal("✖️ Reto finalizado", "Has abandonado antes de terminar las 10 rondas.\n\nResultado: 0 puntos.");
  } else {
    openModal("✖️ Saliste de la ronda", "No pasa nada: vuelve cuando quieras.");
  }
};

/* ---------- INIT (sin auto-start) ---------- */
(function init(){
  updatePolicyStatus();

  // Estado “idle”
  stageTitle.textContent = "Elige un modo para empezar";
  roundsTotalEl.textContent = String(ROUNDS_TOTAL);
  roundEl.textContent = "—";
  correctEl.textContent = "0";
  wrongEl.textContent = "0";
  timeLeftEl.textContent = "—";
  timerFill.style.width = "0%";
  modeLabel.textContent = "—";
  rewardLabel.textContent = "—";

  setModeUI();
  openStartModal();
})();
