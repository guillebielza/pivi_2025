/* points-policy.js
   Reglas para RETOS (aplican DENTRO de cada juego):
   - El modo reto SOLO se puede jugar en fin de semana (sábado/domingo).
   - Cada juego SOLO permite 1 intento en modo reto por fin de semana.
   - Cada juego SOLO puede otorgar puntos 1 vez por fin de semana (normalmente al terminar el reto).

   NOTA: Aquí NO existe modo desarrollador. Aunque exista localStorage "devMode", se ignora.
*/

(function () {
  // reloj (respeta el "día simulado" del modo dev si existe)
  function nowDate() { return (window.PiviClock && PiviClock.now) ? PiviClock.now() : new Date(); }

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
  function isWeekend(date = nowDate()) {
    const d = date.getDay();
    return d === 6 || d === 0; // sábado o domingo
  }

  // Clave del finde basada en sábado (YYYY-MM-DD)
  function weekendKey(date = nowDate()) {
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

  // --- juegos ---
  const ALL_GAMES = ["memory", "wordle", "missing", "quiz", "simon", "reflejos", "atrapa", "muro", "vuelo"];
  // Juegos RETIRADOS (ocultos): no salen en Retos, no cuentan en el resumen
  // del finde y su reto ya no da puntos (si alguien entra por la dirección,
  // solo puede practicar). Sus archivos siguen en la carpeta, intactos.
  // Para recuperar uno: quítalo de esta lista y saca su tarjeta del
  // <template id="juegosRetirados"> de retos.html (y sube el ?v= de este archivo).
  const RETIRED = ["memory", "missing", "atrapa"];
  const GAMES = ALL_GAMES.filter(g => RETIRED.indexOf(g) === -1);
  function isRetired(gameId) { return RETIRED.indexOf(normalizeGameId(gameId)) !== -1; }
  const RETIRED_REASON = "Este juego está retirado: ya no da puntos.";

  // --- API principal ---
  function canPlayWeekendChallenge(gameId, date = nowDate()) {
    if (window.PIVI_DEV_BYPASS) return { ok: true, reason: "" }; // modo dev: reto libre
    const g = normalizeGameId(gameId);
    if (isRetired(g)) return { ok: false, reason: RETIRED_REASON };

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
  function markWeekendChallengePlayed(gameId, date = nowDate()) {
    const g = normalizeGameId(gameId);
    const wk = weekendKey(date);
    localStorage.setItem(playKey(g), wk);
  }

  // Dar puntos (solo 1 vez por finde y por juego)
  function awardWeekendChallengePoints(amount, gameId, date = nowDate()) {
    const g = normalizeGameId(gameId);
    const n = Number(amount) || 0;
    if (n <= 0) return { ok: false, reason: "Cantidad de puntos inválida.", gained: 0 };

    const bypass = !!window.PIVI_DEV_BYPASS; // modo dev: ignora finde/candados
    const wk = weekendKey(date);

    if (!bypass) {
      if (isRetired(g)) return { ok: false, reason: RETIRED_REASON, gained: 0 };
      if (!isWeekend(date)) {
        return { ok: false, reason: "Los retos solo puntúan en fin de semana (sábado y domingo).", gained: 0 };
      }
      // Debe haber “intentado” el reto (evita sumar sin haber entrado)
      if (localStorage.getItem(playKey(g)) !== wk) {
        return { ok: false, reason: "Este reto no está activo o no has iniciado el modo reto.", gained: 0 };
      }
      // Solo 1 premio por finde y por juego
      if (localStorage.getItem(rewardKey(g)) === wk) {
        return { ok: false, reason: "Ya has ganado puntos por este juego este fin de semana.", gained: 0 };
      }
    }

    writePoints(readPoints() + n);
    if (!bypass) localStorage.setItem(rewardKey(g), wk);

    if (window.PiviLedger) {
      var names = { quiz: "Reto Quiz", wordle: "Reto Wordle", memory: "Reto Parejas", missing: "Reto ¿Cuál falta?", simon: "Reto Simón", reflejos: "Reto Reflejos", atrapa: "Reto Atrapacorazones", muro: "Reto Muro de pinchos", vuelo: "Reto Carta voladora" };
      window.PiviLedger.record(g, n, names[g] || ("Reto " + g));
    }

    return { ok: true, reason: "", gained: n };
  }

  function getWeekendRewardStatusText(gameId, date = nowDate()) {
    if (window.PIVI_DEV_BYPASS) return "🛠 DEV: reto disponible siempre";
    const g = normalizeGameId(gameId);

    if (isRetired(g)) return "🗄️ Juego retirado: solo práctica, no da puntos";
    if (!isWeekend(date)) return "⛔ Solo fin de semana (sábado/domingo)";
    const wk = weekendKey(date);

    const played = localStorage.getItem(playKey(g)) === wk;
    const rewarded = localStorage.getItem(rewardKey(g)) === wk;

    if (rewarded) return "⛔ Ya has puntuado este juego este fin de semana";
    if (played) return "✅ Reto en curso: puedes puntuar al terminar";
    return "✅ Puedes jugar reto este fin de semana";
  }

  // --- resumen del finde (lista de Retos y portada): solo juegos activos ---
  function weekendSummary(date = nowDate()) {
    const weekend = isWeekend(date);
    const wk = weekendKey(date);
    const sat = new Date(date);
    sat.setHours(0, 0, 0, 0);
    if (sat.getDay() === 0) sat.setDate(sat.getDate() - 1);
    const from = sat.getTime();
    let log = [];
    try { log = JSON.parse(localStorage.getItem("activityLog")) || []; } catch {}
    // sin pruebas del modo Dev, anulados ni correcciones
    if (window.PiviLedger && PiviLedger.isHidden) log = log.filter(e => !PiviLedger.isHidden(e));
    const games = {};
    let played = 0, points = 0;
    GAMES.forEach(g => {
      const isPlayed = weekend && localStorage.getItem(playKey(g)) === wk;
      const rewarded = weekend && localStorage.getItem(rewardKey(g)) === wk;
      let pts = 0;
      if (weekend) log.forEach(e => { if (e && e.type === g && Date.parse(e.ts) >= from) pts += Number(e.delta) || 0; });
      games[g] = { played: isPlayed, rewarded, points: pts };
      if (isPlayed) played++;
      points += pts;
    });
    return { weekend, played, total: GAMES.length, points, games };
  }

  window.PointsPolicy = {
    GAMES,
    ALL_GAMES,
    RETIRED,
    isRetired,
    weekendSummary,
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
