/* ============================================================
   retos.js — Lista de minijuegos
   - Marcador de puntos.
   - En finde: qué retos ya se han jugado (entre los dos, se
     sincroniza) y cuántos puntos dio cada uno, más un resumen.
   ============================================================ */
const pointsEl = document.getElementById("points");

function getPoints() {
  return Number(localStorage.getItem("points")) || 0;
}

function setPointsUI() {
  if (pointsEl) pointsEl.textContent = String(getPoints());
}

const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
function nowDate() { return (window.PiviClock && PiviClock.now) ? PiviClock.now() : new Date(); }
function daysToSaturday(d) { return ((6 - d.getDay()) + 7) % 7 || 7; }

function renderWeekend() {
  const P = window.PointsPolicy;
  const box = document.getElementById("weekSummary");
  const sub = document.querySelector(".page-head .subtitle");
  if (!P || !P.weekendSummary || !box) return;

  const s = P.weekendSummary();
  if (s.weekend) {
    const all = s.played >= s.total;
    box.innerHTML = all
      ? `🎉 <b>¡Todos los retos hechos este finde!</b> · +${s.points} pts`
      : `Este finde: <b>${s.played}/${s.total}</b> retos jugados · <b>+${s.points} pts</b>`;
    box.className = "week-summary" + (all ? " all" : " on");
  } else {
    const n = daysToSaturday(nowDate());
    const when = n === 1 ? "mañana (sábado)" : `el sábado (en ${n} días)`;
    box.innerHTML = `🔒 Los retos con puntos vuelven <b>${when}</b>. Mientras, puedes practicar cuando quieras.`;
    box.className = "week-summary";
  }
  if (sub) sub.classList.add("hidden");

  document.querySelectorAll(".challenge-card[href]").forEach(card => {
    const id = card.getAttribute("href").replace(/\.html$/, "");
    const h3 = card.querySelector("h3");
    if (!h3) return;
    let badge = h3.querySelector(".game-badge");
    const g = s.games[id];
    card.classList.remove("is-done");
    if (!s.weekend || !g) { if (badge) badge.remove(); return; }
    if (!badge) { badge = document.createElement("span"); h3.appendChild(badge); }
    if (g.played) {
      card.classList.add("is-done");
      badge.className = "game-badge done";
      badge.textContent = g.points > 0 ? `✅ +${g.points}` : "✔️ Jugado";
    } else {
      badge.className = "game-badge todo";
      badge.textContent = "Pendiente";
    }
  });
}

setPointsUI();
renderWeekend();
window.addEventListener("pivi:hydrated", () => { setPointsUI(); renderWeekend(); });
// el modo Dev puede cambiar el día simulado
window.addEventListener("pivi:config", renderWeekend);
