/* ============================================================
   pivi-ledger.js — Registro de actividad, racha y avisos
   ------------------------------------------------------------
   - Mantiene un historial de eventos (activityLog) que viaja a la
     nube y se FUSIONA por unión (nunca se pierde un evento aunque
     dos dispositivos jueguen a la vez).
   - El historial NO es la fuente de verdad de los puntos (eso sigue
     siendo "points"); solo registra qué pasó, para el feed, la racha
     y el aviso "tu pareja ha hecho algo".
   - Si no hay contenedor en la página, los helpers de render no hacen
     nada: el módulo es seguro de incluir en cualquier página.
   ============================================================ */
(function () {
  "use strict";

  var LOG_KEY = "activityLog";
  var STREAK_KEY = "pivi_streak";
  var SEEN_KEY = "pivi_feed_seen";   // local: último evento ya "visto" (para el aviso)
  var DEVICE_KEY = "pivi_device";
  var PENDING_KEY = "pivi_pending_ev"; // local: eventos con puntos aún no subidos (lo lee cloud-sync)
  var FIX_KEY = "pivi_fixes";          // correcciones ya aplicadas (viaja a la nube, unión)
  var REVOKED_KEY = "revokedRewards";  // canjes anulados (viaja a la nube, unión)
  var MAX_EVENTS = 80;

  /* ---------------- CORRECCIONES DE DATOS ----------------
     17-nov-2026: en el iPhone el modo Dev no aislaba (Safari no deja
     sustituir localStorage.setItem) y 7 acciones de prueba llegaron a
     los datos reales. Esta corrección, que se aplica UNA sola vez entre
     todos los dispositivos (queda apuntada en "pivi_fixes"):
       - anula esos eventos (dejan de verse y de contar),
       - devuelve sus puntos con eventos "undo-…" (−1 −6 −10 +100 = +83),
       - deshace el canje de prueba de Beata Pasta (recompensa 6). */
  var FIXES = [{
    id: "fix-2026-11-17-dev",
    label: "Corrección: prueba del modo Dev anulada",
    voids: {
      "wheel-mwl6fnmt-gbjx": 1, "wheel-mwl6o9kf-4luo": 6, "muro-mwl6rgh9-h6p9": 10,
      "reward-mwl7fgjc-fkvh": -100,
      "sim-1794949255720": 0, "sim-1794949257582": 0, "sim-1794949258966": 0
    },
    revokeRewards: ["6"]
  }];
  var VOID = {};
  FIXES.forEach(function (fx) { Object.keys(fx.voids).forEach(function (id) { VOID[id] = 1; }); });
  function isVoid(id) { return !!VOID[id]; }
  // eventos que no se enseñan ni cuentan: de pruebas, anulados o correcciones
  function isHidden(e) {
    return !e || !!e.dev || e.type === "fix" || !!VOID[e.id] || e.device === "pareja-sim";
  }

  var ICONS = {
    wheel: "🎡", code: "🏷️", reward: "🎁",
    quiz: "🧩", wordle: "🟩", memory: "🧠", missing: "👀",
    simon: "🎵", reflejos: "⚡", atrapa: "💘", muro: "💗",
    streak: "🔥", seed: "✨"
  };

  function nowISO() { return new Date().toISOString(); }

  function deviceId() {
    var id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = "d-" + Math.random().toString(36).slice(2, 8);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }

  function readLog() {
    try { var a = JSON.parse(localStorage.getItem(LOG_KEY)); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function writeLog(arr) {
    arr.sort(function (a, b) { return (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0); });
    localStorage.setItem(LOG_KEY, JSON.stringify(arr.slice(-MAX_EVENTS)));
  }
  function visibleLog() { return readLog().filter(function (e) { return !isHidden(e); }); }
  function readArr(k) {
    try { var a = JSON.parse(localStorage.getItem(k)); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }

  /* Registra un evento (delta = puntos ganados/gastados; 0 si no aplica).
     opts.silent: no repinta el feed todavía (p. ej. la ruleta aún gira). */
  function record(type, delta, label, opts) {
    var log = readLog();
    var ev = {
      id: (type || "ev") + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
      ts: nowISO(),
      type: type || "ev",
      delta: Number(delta) || 0,
      label: label || "",
      device: deviceId()
    };
    // hecho en modo Dev: queda marcado y la nube lo ignora aunque se colase
    if (window.PIVI_DEV) ev.dev = true;
    // pendiente de subir: cloud-sync suma estos puntos a los de la nube
    // al fusionar, así nunca se pierden si el otro dispositivo guarda a la vez
    if (ev.delta) {
      var pend;
      try { pend = JSON.parse(localStorage.getItem(PENDING_KEY)); } catch (e) {}
      pend = Array.isArray(pend) ? pend : [];
      pend.push(ev.id);
      localStorage.setItem(PENDING_KEY, JSON.stringify(pend.slice(-60)));
    }
    log.push(ev);
    writeLog(log);
    // este dispositivo ya "ha visto" lo que él mismo hace
    localStorage.setItem(SEEN_KEY, ev.id);
    if (!(opts && opts.silent)) { render(); renderStreak(); }
    return ev;
  }

  /* ---------------- Racha diaria ---------------- */
  function isoDay(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function getStreak() {
    try { return JSON.parse(localStorage.getItem(STREAK_KEY)) || { count: 0, lastDay: null }; }
    catch (e) { return { count: 0, lastDay: null }; }
  }
  function touchStreak() {
    var today = isoDay();
    var data = getStreak();
    if (data.lastDay === today) return data;       // ya contada hoy
    var y = new Date(); y.setDate(y.getDate() - 1);
    data.count = (data.lastDay === isoDay(y)) ? (data.count || 0) + 1 : 1;
    data.lastDay = today;
    localStorage.setItem(STREAK_KEY, JSON.stringify(data));
    renderStreak();
    return data;
  }
  /* ---------- Puntos ganados esta semana (lunes a domingo) ----------
     Sustituye a la racha diaria en la portada: la ruleta es lun/mié y
     los retos el finde, así que la racha se rompía cada martes. */
  function weekStart(d) {
    d = new Date(d || (window.PiviClock && PiviClock.now ? PiviClock.now() : new Date()));
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // lunes
    return d;
  }
  function weekPoints(d) {
    var from = weekStart(d).getTime();
    var sum = 0;
    visibleLog().forEach(function (e) {
      if (e && e.delta > 0 && Date.parse(e.ts) >= from) sum += e.delta;
    });
    return sum;
  }
  function renderStreak() {
    var el = document.getElementById("weekValue");
    if (el) el.textContent = "+" + weekPoints() + " pts";
    var old = document.getElementById("streakValue"); // por si queda alguna página antigua en caché
    if (old) { var s = getStreak(); old.textContent = (s.count || 0) + (s.count === 1 ? " día" : " días"); }
  }

  /* ---------------- Feed de actividad ---------------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function timeAgo(ts) {
    var diff = Math.max(0, (Date.now() - Date.parse(ts)) / 1000);
    if (diff < 60) return "ahora";
    if (diff < 3600) return Math.floor(diff / 60) + " min";
    if (diff < 86400) return Math.floor(diff / 3600) + " h";
    var days = Math.floor(diff / 86400);
    if (days < 7) return days + (days === 1 ? " día" : " días");
    return new Date(ts).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
  }
  function render() {
    var box = document.getElementById("activityFeed");
    if (!box) return;
    var log = visibleLog().slice().reverse();
    if (!log.length) {
      box.innerHTML = '<li class="feed-empty muted">Aún no hay actividad. ¡Gana tus primeros puntos! ✨</li>';
      return;
    }
    var me = deviceId();
    box.innerHTML = log.slice(0, 14).map(function (e) {
      var sign = e.delta > 0 ? "+" + e.delta : (e.delta < 0 ? String(e.delta) : "");
      var cls = e.delta > 0 ? "pos" : (e.delta < 0 ? "neg" : "");
      var mine = e.device === me ? "" : ' title="Desde otro dispositivo"';
      return '<li class="feed-item"' + mine + '>'
        + '<span class="feed-ic">' + (ICONS[e.type] || "•") + '</span>'
        + '<span class="feed-label">' + esc(e.label || e.type) + (e.device !== me ? ' <span class="feed-who">· pareja</span>' : '') + '</span>'
        + (sign ? '<span class="feed-delta ' + cls + '">' + sign + '</span>' : '')
        + '<span class="feed-time">' + timeAgo(e.ts) + '</span>'
        + '</li>';
    }).join("");
  }

  /* Aviso tras sincronizar: ¿hay eventos nuevos de OTRO dispositivo? */
  function notifyNewFromOther() {
    var log = readLog();
    if (!log.length) return;
    var me = deviceId();
    var lastSeen = localStorage.getItem(SEEN_KEY);
    // índice del último visto
    var seenIdx = -1;
    if (lastSeen) {
      for (var i = log.length - 1; i >= 0; i--) { if (log[i].id === lastSeen) { seenIdx = i; break; } }
    }
    // primer evento posterior al visto que sea de otro dispositivo
    var fresh = null;
    for (var j = seenIdx + 1; j < log.length; j++) {
      if (log[j].device !== me && !isHidden(log[j])) { fresh = log[j]; }
    }
    // marca todo como visto
    localStorage.setItem(SEEN_KEY, log[log.length - 1].id);
    if (fresh && window.PiviCore && PiviCore.toast) {
      var txt = fresh.delta > 0 ? "💞 Tu pareja: " + fresh.label + " (+" + fresh.delta + ")"
        : "💞 Tu pareja: " + fresh.label;
      PiviCore.toast(txt, 2600);
    }
    render();
  }

  /* Marca como visto sin avisar (primera carga de la sesión) */
  function markSeen() {
    var log = readLog();
    if (log.length) localStorage.setItem(SEEN_KEY, log[log.length - 1].id);
  }

  /* Aplica las correcciones pendientes (una sola vez entre todos los
     dispositivos). Solo con la nube real activa y tras sincronizar, para
     saber si otro dispositivo ya la aplicó. */
  function applyFixes() {
    if (window.PIVI_DEV || !window.PiviSync) return;
    var done = readArr(FIX_KEY).map(String);
    var todo = FIXES.filter(function (fx) { return done.indexOf(fx.id) === -1; });
    if (!todo.length) return;
    var log = readLog();
    var have = {};
    log.forEach(function (e) { if (e && e.id) have[e.id] = 1; });
    var pend = readArr(PENDING_KEY);
    var revoked = readArr(REVOKED_KEY).map(String);
    todo.forEach(function (fx) {
      Object.keys(fx.voids).forEach(function (origId) {
        var d = Number(fx.voids[origId]) || 0;
        var uid = "undo-" + origId;
        if (!d || have[uid]) return;
        log.push({ id: uid, ts: nowISO(), type: "fix", delta: -d, label: fx.label, device: deviceId(), fix: fx.id, voids: origId });
        pend.push(uid);
        have[uid] = 1;
      });
      (fx.revokeRewards || []).forEach(function (t) { if (revoked.indexOf(String(t)) === -1) revoked.push(String(t)); });
      done.push(fx.id);
    });
    localStorage.setItem(PENDING_KEY, JSON.stringify(pend.slice(-60)));
    localStorage.setItem(REVOKED_KEY, JSON.stringify(revoked));
    localStorage.setItem(FIX_KEY, JSON.stringify(done));
    writeLog(log); // al cambiar el registro, cloud-sync sube todo
    render(); renderStreak();
    if (typeof window.renderRewards === "function") { try { window.renderRewards(); } catch (e) {} }
  }

  window.PiviLedger = {
    record: record,
    readLog: readLog,
    visibleLog: visibleLog,
    isHidden: isHidden,
    isVoid: isVoid,
    applyFixes: applyFixes,
    render: render,
    touchStreak: touchStreak,
    getStreak: getStreak,
    renderStreak: renderStreak,
    renderWeek: renderStreak,
    weekPoints: weekPoints,
    notifyNewFromOther: notifyNewFromOther,
    markSeen: markSeen
  };

  /* init */
  function boot() { render(); renderStreak(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // primera carga: no avisar de lo que ya había; tras hidratar, sí
  var firstHydrate = true;
  window.addEventListener("pivi:hydrated", function () {
    if (firstHydrate) { firstHydrate = false; render(); renderStreak(); markSeen(); }
    else { notifyNewFromOther(); renderStreak(); }
    setTimeout(applyFixes, 0); // tras la 1.ª sincronización (ya se sabe qué hay en la nube)
  });
})();
