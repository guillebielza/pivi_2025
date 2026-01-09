const policy = window.PointsPolicy;
const GAME_ID = "quiz";

/* ---------- points UI ---------- */
const pointsEl = document.getElementById("points");
function getPoints(){ return Number(localStorage.getItem("points")) || 0; }
function setPoints(v){
  const n = Number(v) || 0;
  localStorage.setItem("points", String(n));
  if (pointsEl) pointsEl.textContent = String(n);
}
setPoints(getPoints());

/* ---------- DOM ---------- */
const practiceBtn = document.getElementById("practiceBtn");
const challengeBtn = document.getElementById("challengeBtn");
const restartBtn = document.getElementById("restartBtn");

const policyStatusEl = document.getElementById("policyStatus");
const modeLabelEl = document.getElementById("modeLabel");
const rewardLabelEl = document.getElementById("rewardLabel");

const qIndexEl = document.getElementById("qIndex");
const qTotalEl = document.getElementById("qTotal");
const timeLeftEl = document.getElementById("timeLeft");
const correctEl = document.getElementById("correct");
const wrongEl = document.getElementById("wrong");

const timerFill = document.getElementById("timerFill");

const tagCategory = document.getElementById("tagCategory");
const tagDifficulty = document.getElementById("tagDifficulty");
const questionText = document.getElementById("questionText");
const answersEl = document.getElementById("answers");

const skipBtn = document.getElementById("skipBtn");
const nextBtn = document.getElementById("nextBtn");

const toastEl = document.getElementById("toast");

/* resultado modal */
const overlay = document.getElementById("overlay");
const modalTitle = document.getElementById("modalTitle");
const modalText = document.getElementById("modalText");
const modalOk = document.getElementById("modalOk");
const modalAgain = document.getElementById("modalAgain");

/* inicio modal */
const startOverlay = document.getElementById("startOverlay");
const startText = document.getElementById("startText");
const choosePractice = document.getElementById("choosePractice");
const chooseChallenge = document.getElementById("chooseChallenge");

/* ---------- estado ---------- */
let practiceMode = true;

let allQuestions = [];
let questions = []; // las 10 de la partida

let idx = 0;
let correct = 0;
let wrong = 0;

let locked = false; // bloquea clicks durante corrección
let answered = false;

let timerId = null;
const QUESTION_SECONDS_PRACTICE = 18;
const QUESTION_SECONDS_CHALLENGE = 18;

let timeLeft = 0;

/* ---------- util ---------- */
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
modalAgain.onclick = () => { closeModal(); restartSameMode(); };

/* ---------- policy status ---------- */
function updatePolicyStatus(){
  if (!policyStatusEl) return;

  if (policy?.getWeekendRewardStatusText){
    policyStatusEl.textContent = policy.getWeekendRewardStatusText(GAME_ID);
    return;
  }

  // fallback suave
  policyStatusEl.textContent = "—";
}

/* ---------- start modal ---------- */
function openStartModal(){
  const st = policy?.canPlayWeekendChallenge ? policy.canPlayWeekendChallenge(GAME_ID) : { ok: true, reason: "" };

  chooseChallenge.disabled = !st.ok;
  chooseChallenge.title = st.ok ? "" : st.reason;

  startText.textContent = st.ok
    ? "Elige modo. En Reto respondes 10 preguntas y ganas +1 punto por acierto (1 vez por fin de semana para este juego)."
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

/* ---------- cargar preguntas ---------- */
async function loadQuestions(){
  try{
    const r = await fetch("preguntas.json", { cache: "no-store" });
    if (!r.ok) throw new Error("No se pudo cargar preguntas.json");
    const data = await r.json();

    // validación básica
    allQuestions = (Array.isArray(data) ? data : []).filter(q =>
      q && typeof q.question === "string" &&
      Array.isArray(q.options) && q.options.length === 4 &&
      Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex < 4
    );

    if (allQuestions.length < 10) throw new Error("preguntas.json tiene menos de 10 preguntas válidas");

    questionText.textContent = "Listo ✅ Elige un modo para empezar.";
  } catch(e){
    console.error(e);
    questionText.textContent = "❌ Error cargando preguntas. Revisa preguntas.json";
    toast("Error cargando preguntas");
  }
}

/* ---------- selección de partida ---------- */
function shuffle(arr){
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Para reto: mismas 10 del día (para evitar farmear cambiando refresh)
function pickDailySet(){
  const key = `quiz_daily_${new Date().toISOString().slice(0,10)}`;
  const saved = localStorage.getItem(key);
  if (saved){
    try{
      const ids = JSON.parse(saved);
      if (Array.isArray(ids) && ids.length === 10){
        const picked = ids.map(i => allQuestions[i]).filter(Boolean);
        if (picked.length === 10) return picked;
      }
    } catch {}
  }

  const indices = shuffle([...Array(allQuestions.length).keys()]).slice(0,10);
  localStorage.setItem(key, JSON.stringify(indices));
  return indices.map(i => allQuestions[i]);
}

function pickRandomSet(){
  return shuffle(allQuestions).slice(0, 10);
}

/* ---------- UI ---------- */
function setModeUI(){
  modeLabelEl.textContent = practiceMode ? "Práctica" : "Reto (+ puntos)";
  rewardLabelEl.textContent = practiceMode ? "—" : "Hasta +10";
  qTotalEl.textContent = "10";

  // botón reto habilitado/disabled por policy
  if (policy?.canPlayWeekendChallenge){
    const st = policy.canPlayWeekendChallenge(GAME_ID);
    challengeBtn.disabled = !st.ok;
    challengeBtn.title = st.ok ? "" : st.reason;
  } else {
    challengeBtn.disabled = false;
    challengeBtn.title = "";
  }

  updatePolicyStatus();
}

function updateCounters(){
  qIndexEl.textContent = String(idx + 1);
  correctEl.textContent = String(correct);
  wrongEl.textContent = String(wrong);
}

function renderQuestion(){
  answered = false;
  locked = false;
  nextBtn.disabled = true;

  const q = questions[idx];
  if (!q){
    finishGame();
    return;
  }

  tagCategory.textContent = q.category || "—";
  tagDifficulty.textContent = q.difficulty || "—";
  questionText.textContent = q.question;

  answersEl.innerHTML = "";
  q.options.forEach((opt, i) => {
    const btn = document.createElement("button");
    btn.className = "answer";
    btn.textContent = opt;
    btn.onclick = () => chooseAnswer(i);
    answersEl.appendChild(btn);
  });

  startTimer();
  updateCounters();
}

/* ---------- timer ---------- */
function stopTimer(){
  if (timerId) clearInterval(timerId);
  timerId = null;
}

function startTimer(){
  stopTimer();

  const seconds = practiceMode ? QUESTION_SECONDS_PRACTICE : QUESTION_SECONDS_CHALLENGE;
  timeLeft = seconds;
  timeLeftEl.textContent = String(timeLeft);
  timerFill.style.width = "0%";

  const total = seconds;
  timerId = setInterval(() => {
    timeLeft -= 1;
    timeLeftEl.textContent = String(Math.max(0, timeLeft));

    const pct = ((total - timeLeft) / total) * 100;
    timerFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;

    if (timeLeft <= 0){
      stopTimer();
      timeUp();
    }
  }, 1000);
}

function timeUp(){
  if (locked || answered) return;
  toast("⏱️ Tiempo!");
  markWrongAndReveal();
}

/* ---------- answer flow ---------- */
function disableAnswers(){
  answersEl.querySelectorAll(".answer").forEach(b => b.disabled = true);
}

function chooseAnswer(i){
  if (locked || answered) return;
  stopTimer();

  const q = questions[idx];
  answered = true;
  locked = true;

  const btns = [...answersEl.querySelectorAll(".answer")];
  disableAnswers();

  const correctIdx = q.answerIndex;

  if (i === correctIdx){
    correct += 1;
    btns[i].classList.add("correct");
  } else {
    wrong += 1;
    btns[i].classList.add("wrong");
    if (btns[correctIdx]) btns[correctIdx].classList.add("correct");
    btns.forEach((b, j) => {
      if (j !== i && j !== correctIdx) b.classList.add("neutral");
    });
  }

  updateCounters();
  nextBtn.disabled = false;
  locked = false;
}

function markWrongAndReveal(){
  stopTimer();
  answered = true;

  const q = questions[idx];
  const btns = [...answersEl.querySelectorAll(".answer")];
  disableAnswers();

  wrong += 1;
  const correctIdx = q.answerIndex;
  if (btns[correctIdx]) btns[correctIdx].classList.add("correct");
  btns.forEach((b, j) => {
    if (j !== correctIdx) b.classList.add("neutral");
  });

  updateCounters();
  nextBtn.disabled = false;
}

/* ---------- navigation ---------- */
skipBtn.onclick = () => {
  if (answered) return;
  toast("⏭️ Pasada");
  markWrongAndReveal();
};

nextBtn.onclick = () => {
  if (!answered) return;
  idx += 1;
  if (idx >= questions.length) finishGame();
  else renderQuestion();
};

function finishGame(){
  stopTimer();

  const gained = practiceMode ? 0 : correct; // +1 por acierto
  if (practiceMode){
    openModal("✅ Fin (práctica)", `Aciertos: ${correct}\nFallos: ${wrong}\n\nEn práctica no suma puntos.`);
    return;
  }

  // modo reto: aplicar política una vez por finde para este juego
  const res = policy?.awardWeekendChallengePoints
    ? policy.awardWeekendChallengePoints(gained, GAME_ID)
    : { ok:false, reason:"No se pudo aplicar la política.", gained:0 };

  if (res.ok){
    openModal("🏆 Fin del reto", `Aciertos: ${correct}\nFallos: ${wrong}\n\nPuntos: +${res.gained}`);
  } else {
    openModal("🏁 Fin del reto", `Aciertos: ${correct}\nFallos: ${wrong}\n\nNo puntúa: ${res.reason}`);
  }

  updatePolicyStatus();
}

/* ---------- start modes ---------- */
function resetRun(){
  idx = 0;
  correct = 0;
  wrong = 0;
  updateCounters();
  timeLeftEl.textContent = "—";
  timerFill.style.width = "0%";
}

function startPractice(){
  practiceMode = true;
  questions = pickRandomSet();
  resetRun();
  setModeUI();
  renderQuestion();
  toast("Modo práctica");
}

function startChallenge(){
  const st = policy?.canPlayWeekendChallenge ? policy.canPlayWeekendChallenge(GAME_ID) : { ok: true, reason: "" };
  if (!st.ok){
    openModal("⛔ No disponible", st.reason);
    return;
  }

  practiceMode = false;
  policy?.markWeekendChallengePlayed?.(GAME_ID);

  questions = pickDailySet();
  resetRun();
  setModeUI();
  renderQuestion();
  toast("Modo reto");
}

function restartSameMode(){
  if (practiceMode) startPractice();
  else startChallenge();
}

/* ---------- buttons ---------- */
practiceBtn.onclick = startPractice;
challengeBtn.onclick = startChallenge;
restartBtn.onclick = restartSameMode;

/* ---------- INIT ---------- */
(async function init(){
  await loadQuestions();

  // estado inicial
  setModeUI();
  questionText.textContent = "Elige un modo para empezar";
  updatePolicyStatus();

  openStartModal();
})();
