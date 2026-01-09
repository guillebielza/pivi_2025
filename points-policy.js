/* points-policy.js
   Reglas para RETOS (aplican DENTRO de cada juego):
   - El modo reto SOLO se puede jugar en fin de semana (sábado/domingo).
   - Cada juego SOLO permite 1 intento en modo reto por fin de semana.
   - Cada juego SOLO puede otorgar puntos 1 vez por fin de semana (normalmente al terminar el reto).

   NOTA: Aquí NO existe modo desarrollador. Aunque exista localStorage "devMode", se ignora.
*/

(function () {
  // --- helpers puntos ---
  function readPoints() {
    try {
      if (typeof window.getPoints === "function") return Number(window.getPoints()) || 0;
    } catch {}
    return Number(localStorage.getItem("points")) || 0;
  }

  function writePoints(value) {
    const v = Number(value) || 0;

    try {
      if (typeof window.setPoints === "function") {
        window.setPoints(v);
        return;
      }
    } catch {}

    localStorage.setItem("points", String(v));
    const el = document.getElementById("points");
    if (el) el.textContent = String(v);
  }

  // --- calendario ---
  function isWeekend(date = new Date()) {
    const d = date.getDay();
    return d === 6 || d === 0; // sábado o domingo
  }

  // Clave del finde basada en sábado (YYYY-MM-DD)
  function weekendKey(date = new Date()) {
    const d = new Date(date);
    const day = d.getDay(); // 0 dom, 6 sab
    if (day === 0) d.setDate(d.getDate() - 1); // domingo -> sábado

    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }

  function normalizeGameId(gameId) {
    return String(gameId || "").trim().toLowerCase() || "unknown";
  }

  function playKey(gameId) {
    return `weekend_played_${normalizeGameId(gameId)}`;
  }

  function rewardKey(gameId) {
    return `weekend_rewarded_${normalizeGameId(gameId)}`;
  }

  // --- API principal ---
  function canPlayWeekendChallenge(gameId, date = new Date()) {
    const g = normalizeGameId(gameId);

    if (!isWeekend(date)) {
      return { ok: false, reason: "Los retos solo se pueden jugar en fin de semana (sábado y domingo)." };
    }

    const wk = weekendKey(date);
    if (localStorage.getItem(playKey(g)) === wk) {
      return { ok: false, reason: "Ya has jugado el modo reto de este juego este fin de semana." };
    }

    return { ok: true, reason: "" };
  }

  // Marcar que has ENTRADO al reto (1 intento)
  function markWeekendChallengePlayed(gameId, date = new Date()) {
    const g = normalizeGameId(gameId);
    const wk = weekendKey(date);
    localStorage.setItem(playKey(g), wk);
  }

  // Dar puntos (solo 1 vez por finde y por juego)
  function awardWeekendChallengePoints(amount, gameId, date = new Date()) {
    const g = normalizeGameId(gameId);
    const n = Number(amount) || 0;
    if (n <= 0) return { ok: false, reason: "Cantidad de puntos inválida.", gained: 0 };

    if (!isWeekend(date)) {
      return { ok: false, reason: "Los retos solo puntúan en fin de semana (sábado y domingo).", gained: 0 };
    }

    const wk = weekendKey(date);

    // Debe haber “intentado” el reto (evita sumar sin haber entrado)
    if (localStorage.getItem(playKey(g)) !== wk) {
      return { ok: false, reason: "Este reto no está activo o no has iniciado el modo reto.", gained: 0 };
    }

    // Solo 1 premio por finde y por juego
    if (localStorage.getItem(rewardKey(g)) === wk) {
      return { ok: false, reason: "Ya has ganado puntos por este juego este fin de semana.", gained: 0 };
    }

    writePoints(readPoints() + n);
    localStorage.setItem(rewardKey(g), wk);

    return { ok: true, reason: "", gained: n };
  }

  function getWeekendRewardStatusText(gameId, date = new Date()) {
    const g = normalizeGameId(gameId);

    if (!isWeekend(date)) return "⛔ Solo fin de semana (sábado/domingo)";
    const wk = weekendKey(date);

    const played = localStorage.getItem(playKey(g)) === wk;
    const rewarded = localStorage.getItem(rewardKey(g)) === wk;

    if (rewarded) return "⛔ Ya has puntuado este juego este fin de semana";
    if (played) return "✅ Reto en curso: puedes puntuar al terminar";
    return "✅ Puedes jugar reto este fin de semana";
  }

  window.PointsPolicy = {
    isWeekend,
    weekendKey,
    canPlayWeekendChallenge,
    markWeekendChallengePlayed,
    awardWeekendChallengePoints,
    getWeekendRewardStatusText,
    readPoints,
    writePoints
  };
})();
