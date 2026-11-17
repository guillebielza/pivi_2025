const policy = window.PointsPolicy;
const GAME_ID = "wordle";

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
const gridEl = document.getElementById("grid");
const keyboardEl = document.getElementById("keyboard");
const toastEl = document.getElementById("toast");

const rowEl = document.getElementById("row");
const modeLabelEl = document.getElementById("modeLabel");
const rewardLabelEl = document.getElementById("rewardLabel");
const policyStatusEl = document.getElementById("policyStatus");

const practiceBtn = document.getElementById("practiceBtn");
const challengeBtn = document.getElementById("challengeBtn");
const newBtn = document.getElementById("newBtn");

const overlay = document.getElementById("overlay");
const modalTitle = document.getElementById("modalTitle");
const modalText = document.getElementById("modalText");
const modalOk = document.getElementById("modalOk");
const modalAgain = document.getElementById("modalAgain");

const startOverlay = document.getElementById("startOverlay");
const startText = document.getElementById("startText");
const choosePractice = document.getElementById("choosePractice");
const chooseChallenge = document.getElementById("chooseChallenge");

/* ---------- estado ---------- */
let practiceMode = true;

let secret = "";
let row = 0;
let col = 0;
let grid = Array.from({ length: 6 }, () => Array.from({ length: 5 }, () => ""));
let finished = false;

let WORDS = new Set();      // soluciones (palabras comunes: words-sol5.txt)
let ALLOWED = new Set();    // válidas como intento (diccionario grande: words-es5.txt)
let wordsLoaded = false;

let challengeStarted = false; // el reto se gasta al enviar la primera palabra
function isChallengeRunning(){ return !practiceMode && challengeStarted && !finished; }
if (window.PiviCore && PiviCore.guardChallenge) PiviCore.guardChallenge(isChallengeRunning);

/* ---------- util ---------- */
function todayKey(){
  return (window.PiviCore && PiviCore.isoDate) ? PiviCore.isoDate() : new Date().toISOString().slice(0, 10);
}

function normalizeWord(raw){
  return (raw || "")
    .trim()
    .toUpperCase()
    .replace(/[ÁÀÄÂ]/g, "A")
    .replace(/[ÉÈËÊ]/g, "E")
    .replace(/[ÍÌÏÎ]/g, "I")
    .replace(/[ÓÒÖÔ]/g, "O")
    .replace(/[ÚÙÜÛ]/g, "U")
    .replace(/[^A-ZÑ]/g, "");
}

function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  setTimeout(() => toastEl.classList.add("hidden"), 1200);
}

function openModal(title, text, againLabel){
  modalTitle.textContent = title;
  modalText.textContent = text;
  // tras un reto (ya gastado) "Jugar otra" lleva a la práctica
  modalAgain.textContent = againLabel || (practiceMode ? "Jugar otra" : "Practicar");
  overlay.classList.remove("hidden");
}
function closeModal(){ overlay.classList.add("hidden"); }
modalOk.onclick = closeModal;
modalAgain.onclick = () => { closeModal(); restartSameMode(); };

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
    ? "Elige modo. En Reto hay palabra del día y puedes ganar puntos (1 vez por fin de semana para este juego). El reto empieza al enviar tu primera palabra; si sales después, se pierde."
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

/* ---------- palabras: cómo tener muchas ---------- */
/*
  OPCIÓN RECOMENDADA:
  - Crea un archivo "words-es5.txt" en tu proyecto.
  - Una palabra por línea, 5 letras, SIN tildes.
  - Ej:
      CASA
      PERRO
      LUNES
      ...
*/
async function loadList(file){
  const r = await fetch(file, { cache: "no-cache" });
  if (!r.ok) throw new Error("No " + file);
  const text = await r.text();
  return text.split(/\r?\n/).map(normalizeWord).filter(w => w.length === 5);
}

async function loadWords(){
  // mini diccionario base por si no carga ningún fichero
  const base = [
    "CASAS","PIZZA","FUEGO","SALSA","NUBES","DULCE","CARTA","PLAZA","NOCHE","RATON",
    "LIMON","GATOS","PERLA","BESOS","HUEVO","JUEGO","PLATO","SUELO","RISAS","MENTE",
    "HEROE","SILLA","MANGO","FRESA","PIANO","TECHO","BOLSA","CIELO","RUMBA","TRONO"
  ].map(normalizeWord).filter(w => w.length === 5);

  const [all, sol] = await Promise.all([
    loadList("words-es5.txt").catch(() => []),
    loadList("words-sol5.txt").catch(() => [])
  ]);

  // el diccionario grande no trae plurales: estos comunes también valen como intento
  const plurals = ["BESOS","BODAS","CAJAS","CAMAS","CAÑAS","CELOS","COCOS","DAMAS","DATOS","DEDOS","DUNAS","FOCAS","FOTOS","GATOS","GEMAS","GOTAS","HIJOS","HILOS","HOJAS","HORAS","ISLAS","JOYAS","JUGOS","KIWIS","LADOS","LAGOS","LOBOS","LOROS","MANOS","MAPAS","MARES","MIMOS","MODOS","MONOS","MUROS","NAVES","NIÑOS","NUBES","NUDOS","ONDAS","PASOS","PATOS","PECES","PERAS","PISOS","POCOS","PUÑOS","RAMAS","RAMOS","RANAS","RATOS","RAYOS","RISAS","RIZOS","ROCAS","SAPOS","TACOS","TELAS","TODOS","VASOS","VENAS","VINOS","VOCES","ZONAS","ZUMOS"];

  // intentos válidos: diccionario grande + soluciones + plurales + base
  [...base, ...plurals, ...all, ...sol].forEach(w => ALLOWED.add(w));
  // la palabra secreta sale SOLO de palabras comunes (antes salían
  // cosas como ARELE o VOTRI del diccionario de 9.500)
  (sol.length ? sol : base).forEach(w => WORDS.add(w));
  wordsLoaded = all.length > 0;
}

/* ---------- word selection ---------- */
function pickRandomWord(){
  const arr = Array.from(WORDS);
  return arr[Math.floor(Math.random() * arr.length)];
}

function getDailyWord(){
  const key = `wordle_daily_${todayKey()}`;
  const saved = localStorage.getItem(key);
  if (saved && saved.length === 5) return saved;

  const w = pickRandomWord();
  localStorage.setItem(key, w);
  return w;
}

/* ---------- UI build ---------- */
function buildGrid(){
  gridEl.innerHTML = "";
  for (let r = 0; r < 6; r++){
    const rowDiv = document.createElement("div");
    rowDiv.className = "row";
    for (let c = 0; c < 5; c++){
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.id = `cell-${r}-${c}`;
      rowDiv.appendChild(cell);
    }
    gridEl.appendChild(rowDiv);
  }
}

const KEY_ROWS = [
  ["Q","W","E","R","T","Y","U","I","O","P"],
  ["A","S","D","F","G","H","J","K","L","Ñ"],
  ["ENTER","Z","X","C","V","B","N","M","⌫"]
];

function buildKeyboard(){
  keyboardEl.innerHTML = "";
  KEY_ROWS.forEach((keys, idx) => {
    const rowDiv = document.createElement("div");
    rowDiv.className = "krow" + (idx===1 ? " second" : idx===2 ? " third" : "");
    keys.forEach(k => {
      const btn = document.createElement("button");
      btn.className = "key";
      btn.textContent = k;
      btn.dataset.key = k;
      btn.onclick = () => handleKey(k);
      rowDiv.appendChild(btn);
    });
    keyboardEl.appendChild(rowDiv);
  });
}

function setCell(r,c,letter){
  const el = document.getElementById(`cell-${r}-${c}`);
  if (!el) return;
  el.textContent = letter || "";
}

function setRowIndicator(){
  rowEl.textContent = String(row + 1);
}

function setModeUI(){
  modeLabelEl.textContent = practiceMode ? "Práctica" : "Reto (+ puntos)";
  rewardLabelEl.textContent = practiceMode ? "—" : "Hasta +8";
  updatePolicyStatus();

  if (policy?.canPlayWeekendChallenge){
    const st = policy.canPlayWeekendChallenge(GAME_ID);
    challengeBtn.disabled = !st.ok;
    challengeBtn.title = st.ok ? "" : st.reason;
  }
}

/* ---------- gameplay ---------- */
function resetState(){
  grid = Array.from({ length: 6 }, () => Array.from({ length: 5 }, () => ""));
  row = 0;
  col = 0;
  finished = false;
  buildGrid();
  setRowIndicator();
  toastEl.classList.add("hidden");

  // reset teclado colores
  keyboardEl.querySelectorAll(".key").forEach(k => {
    k.classList.remove("correct","present","absent");
  });
}

function startPractice(){
  if (window.PiviCore && !PiviCore.confirmLeave()) return;
  practiceMode = true;
  secret = pickRandomWord();
  resetState();
  setModeUI();
  toast("Modo práctica: palabra aleatoria");
}

function startChallenge(){
  if (isChallengeRunning()){ toast("Ya estás jugando el reto 😉"); return; }
  const st = policy?.canPlayWeekendChallenge ? policy.canPlayWeekendChallenge(GAME_ID) : { ok: true, reason: "" };
  if (!st.ok){
    openModal("⛔ No disponible", st.reason, "Practicar");
    return;
  }

  practiceMode = false;
  challengeStarted = false;

  secret = getDailyWord();
  resetState();
  setModeUI();
  toast("Reto: escribe tu primera palabra para empezar");
}

// "Reiniciar" / "Jugar otra": el reto solo se juega una vez, así que
// después (o desde práctica) siempre arranca una práctica
function restartSameMode(){
  if (isChallengeRunning()){ toast("🔒 El reto no se puede reiniciar"); return; }
  startPractice();
}

function applyKeyColor(letter, state){
  const keyBtn = keyboardEl.querySelector(`.key[data-key="${letter}"]`);
  if (!keyBtn) return;

  // prioridad: correct > present > absent
  if (state === "correct"){
    keyBtn.classList.remove("present","absent");
    keyBtn.classList.add("correct");
  } else if (state === "present"){
    if (!keyBtn.classList.contains("correct")){
      keyBtn.classList.remove("absent");
      keyBtn.classList.add("present");
    }
  } else if (state === "absent"){
    if (!keyBtn.classList.contains("correct") && !keyBtn.classList.contains("present")){
      keyBtn.classList.add("absent");
    }
  }
}

function scoreForWin(attemptIndex){
  // attemptIndex: 0..5 (1..6)
  const map = [8,7,6,5,4,3];
  return map[attemptIndex] ?? 3;
}

function evaluateGuess(guess, answer){
  // Wordle clásico con repetidas
  const res = Array(5).fill("absent");
  const a = answer.split("");
  const g = guess.split("");

  // correct primero
  for (let i=0;i<5;i++){
    if (g[i] === a[i]){
      res[i] = "correct";
      a[i] = null;
      g[i] = null;
    }
  }
  // present
  for (let i=0;i<5;i++){
    if (!g[i]) continue;
    const idx = a.indexOf(g[i]);
    if (idx !== -1){
      res[i] = "present";
      a[idx] = null;
    }
  }
  return res;
}

function paintRow(r, states){
  for (let c=0;c<5;c++){
    const cell = document.getElementById(`cell-${r}-${c}`);
    if (!cell) continue;
    cell.classList.remove("correct","present","absent");
    cell.classList.add(states[c]);
  }
}

function shakeRow(r){
  const el = gridEl.children[r];
  if (!el) return;
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
}

function submitGuess(){
  if (finished) return;
  if (col < 5){ toast("Te faltan letras"); shakeRow(row); return; }

  const guess = grid[row].join("");
  if ((ALLOWED.size > 0) && !ALLOWED.has(guess)){
    toast("No está en el diccionario");
    shakeRow(row);
    return;
  }

  // primera palabra del reto: ahora sí se gasta el intento del finde
  if (!practiceMode && !challengeStarted){
    const st = policy?.canPlayWeekendChallenge ? policy.canPlayWeekendChallenge(GAME_ID) : { ok: true, reason: "" };
    if (!st.ok){ finished = true; openModal("⛔ No disponible", st.reason, "Practicar"); return; }
    policy?.markWeekendChallengePlayed?.(GAME_ID);
    challengeStarted = true;
    updatePolicyStatus();
  }

  const states = evaluateGuess(guess, secret);
  paintRow(row, states);

  for (let i=0;i<5;i++){
    applyKeyColor(guess[i], states[i]);
  }

  if (guess === secret){
    finished = true;

    if (practiceMode){
      openModal("✅ ¡Correcto!", `La palabra era ${secret}. (Modo práctica, no suma puntos)`);
      return;
    }

    const pts = scoreForWin(row);
    const res = policy?.awardWeekendChallengePoints
      ? policy.awardWeekendChallengePoints(pts, GAME_ID)
      : { ok:false, reason:"No se pudo aplicar la política.", gained:0 };

    if (res.ok){
      openModal("🏆 ¡Ganaste!", `La palabra era ${secret}.\n\nPuntos: +${res.gained}`);
    } else {
      openModal("🏁 Ganaste", `La palabra era ${secret}.\n\nPero no puntúa: ${res.reason}`);
    }
    updatePolicyStatus();
    return;
  }

  row++;
  col = 0;
  setRowIndicator();

  if (row >= 6){
    finished = true;

    if (practiceMode){
      openModal("😬 Se acabaron los intentos", `La palabra era ${secret}. (Modo práctica)`);
    } else {
      openModal("😬 No acertaste", `La palabra era ${secret}.\n\nPuntos: 0`);
      updatePolicyStatus();
    }
  }
}

function handleKey(k){
  if (finished || !secret) return; // aún no se ha elegido modo

  if (k === "ENTER"){ submitGuess(); return; }
  if (k === "⌫"){ backspace(); return; }

  const letter = normalizeWord(k);
  if (letter.length !== 1) return;

  if (col >= 5) return;
  grid[row][col] = letter;
  setCell(row, col, letter);
  col++;
}

function backspace(){
  if (finished) return;
  if (col <= 0) return;
  col--;
  grid[row][col] = "";
  setCell(row, col, "");
}

/* ---------- events ---------- */
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.querySelector(".overlay:not(.hidden)")) return; // con una ventana abierta, el teclado es suyo
  if (e.key === "Enter") { e.preventDefault(); handleKey("ENTER"); }
  else if (e.key === "Backspace") handleKey("⌫");
  else {
    const k = e.key.toUpperCase();
    if (/^[A-ZÑ]$/.test(k)) handleKey(k);
  }
});

practiceBtn.onclick = startPractice;
challengeBtn.onclick = startChallenge;
newBtn.onclick = restartSameMode;

/* ---------- INIT ---------- */
(async function init(){
  await loadWords();

  buildGrid();
  buildKeyboard();

  // idle state
  setRowIndicator();
  modeLabelEl.textContent = "—";
  rewardLabelEl.textContent = "—";
  updatePolicyStatus();

  openStartModal();
})();

