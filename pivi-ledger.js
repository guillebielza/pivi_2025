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
  var MAX_EVENTS = 80;

  var ICONS = {
    wheel: "🎡", code: "🏷️", reward: "🎁",
    quiz: "🧩", wordle: "🟩", memory: "🧠", missing: "👀",
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

  /* Registra un evento (delta = puntos ganados/gastados; 0 si no aplica) */
  function record(type, delta, label) {
    var log = readLog();
    var ev = {
      id: (type || "ev") + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
      ts: nowISO(),
      type: type || "ev",
      delta: Number(delta) || 0,
      label: label || "",
      device: deviceId()
    };
    log.push(ev);
    writeLog(log);
    // este dispositivo ya "ha visto" lo que él mismo hace
    localStorage.setItem(SEEN_KEY, ev.id);
    render();
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
  function renderStreak() {
    var el = document.getElementById("streakValue");
    if (!el) return;
    var s = getStreak();
    el.textContent = (s.count || 0) + (s.count === 1 ? " día" : " días");
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
    var log = readLog().slice().reverse();
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
      if (log[j].device !== me) { fresh = log[j]; }
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

  window.PiviLedger = {
    record: record,
    readLog: readLog,
    render: render,
    touchStreak: touchStreak,
    getStreak: getStreak,
    renderStreak: renderStreak,
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
  });
})();
