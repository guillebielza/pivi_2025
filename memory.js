const policy = window.PointsPolicy;
const GAME_ID = "memory";

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
const boardEl = document.getElementById("board");
const timeLeftEl = document.getElementById("timeLeft");
const matchesEl = document.getElementById("matches");
const totalPairsEl = document.getElementById("totalPairs");
const mistakesEl = document.getElementById("mistakes");
const modeLabelEl = document.getElementById("modeLabel");
const timerFillEl = document.getElementById("timerFill");

const practiceBtn = document.getElementById("practiceBtn");
const startBtn = document.getElementById("startBtn");
const restartBtn = document.getElementById("restartBtn");
const giveUpBtn = document.getElementById("giveUpBtn");

const overlay = document.getElementById("overlay");
const modalTitle = document.getElementById("modalTitle");
const modalText = document.getElementById("modalText");
const modalClose = document.getElementById("modalClose");
const modalAgain = document.getElementById("modalAgain");

const startOverlay = document.getElementById("startOverlay");
const startText = document.getElementById("startText");
const choosePractice = document.getElementById("choosePractice");
const chooseChallenge = document.getElementById("chooseChallenge");

const policyStatusEl = document.getElementById("policyStatus");

/* ---------- configuración ---------- */
const PRACTICE_SECONDS_LABEL = "∞";
const CHALLENGE_SECONDS = 60;
const SCORE_RULES = { base: 6, max: 12 };

/* ---------- estado ---------- */
let practiceMode = true;
let timerId = null;
let timeLeft = CHALLENGE_SECONDS;

let first = null;
let second = null;
let lock = false;

let matches = 0;
let mistakes = 0;
let playing = false;       // hay partida en marcha
let mismatchTimer = null;  // pausa para ver las dos cartas falladas

function isChallengeRunning(){ return playing && !practiceMode; }
if (window.PiviCore && PiviCore.guardChallenge) PiviCore.guardChallenge(isChallengeRunning);

const EMOJIS = ["🍓","🍋","🍇","🍉","🍒","🍑","🥝","🍍"]; // 8 parejas

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
function shuffle(arr){
  for (let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ---------- puntuación ---------- */
function computeChallengePoints({ secondsLeft, mistakes }){
  const bonusTiempo = clamp(Math.floor((Number(secondsLeft) || 0) / 10), 0, 6);
  const penal = Math.floor((Number(mistakes) || 0) / 4); // ✅ -1 cada 4 fallos
  const raw = SCORE_RULES.base + bonusTiempo - penal;
  const total = clamp(raw, 0, SCORE_RULES.max);
  return { total, base: SCORE_RULES.base, bonusTiempo, penal };
}

/* ---------- modales ---------- */
function openModal(title, text, againLabel){
  modalTitle.textContent = title;
  modalText.textContent = text;
  // tras un reto (ya gastado) "Jugar otra" lleva a la práctica
  modalAgain.textContent = againLabel || (practiceMode ? "Jugar otra" : "Practicar");
  overlay.classList.remove("hidden");
}
function closeModal(){ overlay.classList.add("hidden"); }
modalClose.onclick = closeModal;

modalAgain.onclick = () => {
  closeModal();
  restartSameMode();
};

/* ---------- policy status ---------- */
function updatePolicyStatus(){
  if (!policyStatusEl || !policy?.getWeekendRewardStatusText) return;
  policyStatusEl.textContent = policy.getWeekendRewardStatusText(GAME_ID);
}

/* ---------- start modal ---------- */
function openStartModal(){
  const st = policy?.canPlayWeekendChallenge ? policy.canPlayWeekendChallenge(GAME_ID) : { ok: true, reason: "" };

  chooseChallenge.disabled = !st.ok;
  chooseChallenge.title = st.ok ? "" : st.reason;

  startText.textContent = st.ok
    ? "Elige modo. En Reto tienes 60 s y puedes ganar puntos (1 vez por fin de semana para este juego). Si sales a mitad, el reto se pierde."
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

/* ---------- UI ---------- */
function setModeUI(){
  modeLabelEl.textContent = practiceMode ? "Práctica" : "Reto (+ puntos)";

  if (policy?.canPlayWeekendChallenge){
    const st = policy.canPlayWeekendChallenge(GAME_ID);
    startBtn.disabled = !st.ok;
    startBtn.title = st.ok ? "" : st.reason;
  }

  updatePolicyStatus();
}

function setTimerUI(){
  if (practiceMode){
    timeLeftEl.textContent = PRACTICE_SECONDS_LABEL;
    timerFillEl.style.width = "0%";
    return;
  }
  timeLeftEl.textContent = String(timeLeft) + "s";
  const pct = clamp(timeLeft / CHALLENGE_SECONDS, 0, 1) * 100;
  timerFillEl.style.width = `${pct}%`;
}

function resetStats(){
  matches = 0;
  mistakes = 0;
  matchesEl.textContent = "0";
  mistakesEl.textContent = "0";
}

/* ---------- tablero ---------- */
function buildBoard(){
  boardEl.innerHTML = "";
  const values = shuffle([...EMOJIS, ...EMOJIS]);
  totalPairsEl.textContent = String(EMOJIS.length);

  values.forEach((emoji) => {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.value = emoji;
    card.innerHTML = `
      <div class="card-inner">
        <div class="card-face card-front">❓</div>
        <div class="card-face card-back">${emoji}</div>
      </div>
    `;
    card.addEventListener("click", () => onCardClick(card));
    boardEl.appendChild(card);
  });
}

// cierra al momento las dos falladas (si aún se estaban viendo)
function resolveMismatch(){
  if (!mismatchTimer) return;
  clearTimeout(mismatchTimer);
  mismatchTimer = null;
  if (first) first.classList.remove("flipped");
  if (second) second.classList.remove("flipped");
  first = null; second = null;
  lock = false;
}

function onCardClick(card){
  if (!playing) return;
  // tocar otra carta mientras se ven las falladas: se cierran ya y se sigue
  if (mismatchTimer && card !== first && card !== second) resolveMismatch();
  if (lock) return;
  if (card.classList.contains("flipped")) return;
  if (card.classList.contains("matched")) return;

  card.classList.add("flipped");
  if (!first) { first = card; return; }

  second = card;
  lock = true;

  if (first.dataset.value === second.dataset.value) {
    first.classList.add("matched");
    second.classList.add("matched");
    matches++;
    matchesEl.textContent = String(matches);
    first = null; second = null;

    if (matches === EMOJIS.length) finishWin();
    else lock = false;
  } else {
    mistakes++;
    mistakesEl.textContent = String(mistakes);
    mismatchTimer = setTimeout(() => {
      mismatchTimer = null;
      first.classList.remove("flipped");
      second.classList.remove("flipped");
      first = null; second = null;
      lock = false;
    }, 800);
  }
}

/* ---------- timer ---------- */
function stopTimer(){
  if (timerId) clearInterval(timerId);
  timerId = null;
}

function startTimer(){
  stopTimer();
  timeLeft = CHALLENGE_SECONDS;
  setTimerUI();

  timerId = setInterval(() => {
    timeLeft--;
    setTimerUI();
    if (timeLeft <= 0){
      stopTimer();
      finishLose();
    }
  }, 1000);
}

/* ---------- finales ---------- */
function finishWin(){
  stopTimer();
  lock = true;
  playing = false;

  if (practiceMode){
    openModal("✅ ¡Genial!", "Has completado todas las parejas (modo práctica).");
    return;
  }

  const breakdown = computeChallengePoints({ secondsLeft: timeLeft, mistakes });

  const res = policy?.awardWeekendChallengePoints
    ? policy.awardWeekendChallengePoints(breakdown.total, GAME_ID)
    : { ok: false, reason: "No se pudo aplicar la política.", gained: 0 };

  if (res.ok) {
    openModal(
      "🏆 ¡Reto completado!",
      `Puntos: +${res.gained}\n\n` +
      `• Base: +${breakdown.base}\n` +
      `• Bonus tiempo (${timeLeft}s): +${breakdown.bonusTiempo}\n` +
      `• Penal (fallos ${mistakes}): -${breakdown.penal}\n` +
      `= Total: ${breakdown.total}`
    );
  } else {
    openModal("🏁 Reto completado", `Has ganado, pero no puntúa: ${res.reason}`);
  }

  updatePolicyStatus();
}

function finishLose(){
  lock = true;
  playing = false;
  if (practiceMode){
    openModal("⏱️ Se acabó el tiempo", "Modo práctica: prueba de nuevo cuando quieras.");
  } else {
    openModal("⏱️ Se acabó el tiempo", "No has completado todas las parejas a tiempo (0 puntos).");
  }
  updatePolicyStatus();
}

/* ---------- modos ---------- */
// Cartas boca abajo y quietas hasta que se pulse "▶ Empezar"
function prepareBoard(){
  stopTimer();
  clearTimeout(mismatchTimer); mismatchTimer = null;
  playing = false;
  lock = true;
  first = null; second = null;
  timeLeft = CHALLENGE_SECONDS;
  resetStats();
  buildBoard();
  setModeUI();
  setTimerUI();
}

// Al pulsar "Empezar reto": ahora sí se gasta el intento del finde
function beginChallenge(){
  const st = policy?.canPlayWeekendChallenge ? policy.canPlayWeekendChallenge(GAME_ID) : { ok: true, reason: "" };
  if (!st.ok){ openModal("⛔ No disponible", st.reason, "Practicar"); return false; }
  policy?.markWeekendChallengePlayed?.(GAME_ID);
  playing = true;
  updatePolicyStatus();
  return true;
}

function startPractice(){
  if (window.PiviCore && !PiviCore.confirmLeave()) return;
  practiceMode = true;
  prepareBoard();
  PiviCore.readyGate(boardEl, {
    label: "Empezar",
    hint: "Encuentra las 8 parejas de frutas",
    onStart: () => { playing = true; lock = false; }
  });
}

function startChallenge(){
  if (isChallengeRunning()){ PiviCore.toast("Ya estás jugando el reto 😉"); return; }
  const st = policy?.canPlayWeekendChallenge ? policy.canPlayWeekendChallenge(GAME_ID) : { ok: true, reason: "" };
  if (!st.ok){
    openModal("⛔ No disponible", st.reason, "Practicar");
    return;
  }

  practiceMode = false;
  prepareBoard();
  PiviCore.readyGate(boardEl, {
    label: "Empezar reto",
    hint: "Tienes 60 segundos. Al pulsar, el reto cuenta (1 vez por finde).",
    onBegin: beginChallenge,
    onStart: () => { lock = false; startTimer(); }
  });
}

// "Reiniciar" / "Jugar otra": el reto solo se juega una vez, así que
// después (o desde práctica) siempre arranca una práctica
function restartSameMode(){
  if (isChallengeRunning()){ PiviCore.toast("🔒 El reto no se puede reiniciar"); return; }
  startPractice();
}

/* ---------- botones ---------- */
practiceBtn.onclick = startPractice;
startBtn.onclick = startChallenge;
restartBtn.onclick = restartSameMode;

giveUpBtn.onclick = () => {
  if (!playing) { PiviCore.toast("No hay ninguna partida en marcha"); return; }
  if (!practiceMode && !confirm("Si abandonas el reto, se queda en 0 puntos y no se puede repetir este finde.\n\n¿Abandonar?")) return;
  stopTimer();
  lock = true;
  playing = false;
  openModal("✖️ Abandonado", practiceMode ? "Has salido del modo práctica." : "Has abandonado el reto (0 puntos).");
  updatePolicyStatus();
};

/* ---------- INIT (sin auto-start) ---------- */
(function init(){
  updatePolicyStatus();

  // Estado idle
  boardEl.innerHTML = "";
  totalPairsEl.textContent = String(EMOJIS.length);
  matchesEl.textContent = "0";
  mistakesEl.textContent = "0";
  timeLeftEl.textContent = "—";
  timerFillEl.style.width = "0%";
  modeLabelEl.textContent = "—";
  setModeUI();

  openStartModal();
})();
