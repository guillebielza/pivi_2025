// Cuenta atrás hasta el 10 de enero de 2026 (00:00)
// Se usa la hora local del navegador. En España/Madrid es correcto.
// Si quieres forzar a “hora Madrid” de forma estricta (sin depender del PC),
// lo hacemos con una librería o con conversión a Europe/Madrid.

const TARGET = new Date(2026, 0, 10, 0, 0, 0); // 10/01/2026 00:00

const dEl = document.getElementById("d");
const hEl = document.getElementById("h");
const mEl = document.getElementById("m");
const sEl = document.getElementById("s");

const readyEl = document.getElementById("ready");
const countdownEl = document.getElementById("countdown");
const openDateText = document.getElementById("openDateText");

function pad2(n){ return String(n).padStart(2, "0"); }

function formatDateES(date){
  return date.toLocaleDateString("es-ES", { day:"numeric", month:"long", year:"numeric" });
}

openDateText.textContent = formatDateES(TARGET);

function tick(){
  const now = new Date();
  let diffMs = TARGET - now;

  if (diffMs <= 0){
    dEl.textContent = "0";
    hEl.textContent = "00";
    mEl.textContent = "00";
    sEl.textContent = "00";
    countdownEl.classList.add("hidden");
    readyEl.classList.remove("hidden");
    return;
  }

  const totalSeconds = Math.floor(diffMs / 1000);

  const days = Math.floor(totalSeconds / (24 * 3600));
  const rem1 = totalSeconds % (24 * 3600);
  const hours = Math.floor(rem1 / 3600);
  const rem2 = rem1 % 3600;
  const mins = Math.floor(rem2 / 60);
  const secs = rem2 % 60;

  dEl.textContent = String(days);
  hEl.textContent = pad2(hours);
  mEl.textContent = pad2(mins);
  sEl.textContent = pad2(secs);
}

tick();
setInterval(tick, 1000);
