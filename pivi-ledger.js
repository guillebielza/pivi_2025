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
   - RECUERDOS (para que el histórico dure años):
       · "pivi_canjes": una "foto" de cada canje (nombre, emoji, puntos,
         fecha, quién). No depende del catálogo: aunque un premio se
         edite o se quite, su recuerdo queda igual. Nunca se recorta.
       · "pivi_meses": resumen permanente de cada mes (puntos ganados,
         por ruleta/retos/códigos…). El registro de eventos sí se
         recorta, pero antes cuenta en el resumen de su mes.
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
  var CANJES_KEY = "pivi_canjes";      // recuerdos: una foto por canje (nube, unión por id)
  var MESES_KEY = "pivi_meses";        // resumen permanente por mes (nube, gana el más completo)
  var MAX_EVENTS = 80;                 // mínimo que se guarda (además de todo el mes actual y el anterior)

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
    simon: "🎵", reflejos: "⚡", atrapa: "💘", muro: "💗", vuelo: "💌",
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
  function byTs(a, b) { return (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0); }
  // Qué eventos se guardan: los 80 últimos y, además, TODOS los del mes
  // actual y el anterior (así el resumen de esos meses siempre está completo).
  function trimLog(arr) {
    arr = arr.slice().sort(byTs);
    if (arr.length <= MAX_EVENTS) return arr;
    var n = new Date();
    var from = new Date(n.getFullYear(), n.getMonth() - 1, 1).getTime();
    return arr.filter(function (e, i) { return i >= arr.length - MAX_EVENTS || Date.parse(e.ts) >= from; });
  }
  function writeLog(arr) {
    updateMeses(arr); // antes de recortar: lo que salga del registro ya cuenta en su mes
    localStorage.setItem(LOG_KEY, JSON.stringify(trimLog(arr)));
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

  /* ---------------- Resumen permanente por mes ---------------- */
  var GAME_TYPES = { quiz: 1, wordle: 1, memory: 1, missing: 1, simon: 1, reflejos: 1, atrapa: 1, muro: 1, vuelo: 1 };
  function pad2(n) { return String(n).padStart(2, "0"); }
  function monthKey(ts) { var d = new Date(ts); return d.getFullYear() + "-" + pad2(d.getMonth() + 1); }
  function summarize(log) {
    var out = {};
    (log || []).forEach(function (e) {
      if (isHidden(e) || !e.ts || isNaN(Date.parse(e.ts))) return;
      var m = monthKey(e.ts);
      var s = out[m] || (out[m] = { n: 0, ganado: 0, gastado: 0, ruleta: 0, retos: 0, retosN: 0, codigos: 0 });
      var d = Number(e.delta) || 0;
      s.n++;
      if (d > 0) s.ganado += d;
      if (e.type === "reward" && d < 0) s.gastado -= d;
      if (e.type === "wheel") s.ruleta += d;
      else if (e.type === "code") s.codigos += d;
      else if (GAME_TYPES[e.type]) { s.retos += d; s.retosN++; }
    });
    return out;
  }
  function parseObj(v) {
    try { var o = typeof v === "string" ? JSON.parse(v) : v; return (o && typeof o === "object" && !Array.isArray(o)) ? o : {}; }
    catch (e) { return {}; }
  }
  // Por mes gana el resumen con MÁS eventos (el más completo); a igualdad, el último que se pasa
  function mergeMeses() {
    var out = {};
    Array.prototype.forEach.call(arguments, function (o) {
      o = parseObj(o);
      Object.keys(o).forEach(function (m) {
        var v = o[m];
        if (v && typeof v === "object" && (!out[m] || (Number(v.n) || 0) >= (Number(out[m].n) || 0))) out[m] = v;
      });
    });
    return out;
  }
  function readMeses() { return parseObj(localStorage.getItem(MESES_KEY)); }
  function updateMeses(log) {
    var cur = readMeses();
    var next = mergeMeses(cur, summarize(log));
    if (JSON.stringify(next) !== JSON.stringify(cur)) localStorage.setItem(MESES_KEY, JSON.stringify(next));
  }

  /* ---------------- Recuerdos: una foto de cada canje ----------------
     id = la marca del canje en "redeemedRewards" ("6#k3x9…"), así una
     anulación (revokedRewards) también lo quita de Recuerdos. */
  function rewardName(r) {
    if (r && r.mensajeHistorico) return r.mensajeHistorico.split("—")[0].trim();
    return r ? (r.tipo || "Premio") + " de " + r.coste + " pts" : "Premio";
  }
  function rewardDetail(r) {
    var t = (r && r.mensajeHistorico) || "";
    var i = t.indexOf("—");
    return i >= 0 ? t.slice(i + 1).trim() : "";
  }
  function snapshot(r, mark, ts) {
    return {
      id: String(mark), rid: r ? r.id : null,
      emoji: (r && r.textoBoton) || "🎁", nombre: rewardName(r), detalle: rewardDetail(r),
      tipo: (r && r.tipo) || "", coste: r ? Number(r.coste) || 0 : 0, ts: ts || null
    };
  }
  function readCanjes() { return readArr(CANJES_KEY).filter(function (c) { return c && c.id; }); }
  function recordCanje(r, mark) {
    var list = readCanjes();
    var c = snapshot(r, mark, nowISO());
    c.device = deviceId();
    if (window.PIVI_DEV) c.dev = true; // pruebas: la nube lo ignora
    list.push(c);
    localStorage.setItem(CANJES_KEY, JSON.stringify(list));
    return c;
  }
  // Canjes de antes (o hechos desde una versión vieja de la web) que aún no
  // tienen foto: se crea a partir del catálogo. La fecha sale de la propia
  // marca ("6#<fecha en base 36><3 letras>") o, si es antigua, del registro.
  function markDate(mark) {
    var tok = String(mark).split("#")[1];
    if (!tok || tok.length < 6) return null;
    var ms = parseInt(tok.slice(0, -3), 36);
    return (ms > 1.5e12 && ms < 4e12) ? new Date(ms).toISOString() : null;
  }
  function ensureCanjes(catalog) {
    if (!Array.isArray(catalog) || !catalog.length) return 0;
    var revoked = {}; readArr(REVOKED_KEY).forEach(function (t) { revoked[String(t)] = 1; });
    var list = readCanjes();
    var have = {}; list.forEach(function (c) { have[c.id] = 1; });
    var byId = {}; catalog.forEach(function (r) { byId[r.id] = r; });
    var log = readLog(), usedEv = {}, added = 0;
    readArr("redeemedRewards").forEach(function (t) {
      var mark = String(t);
      if (revoked[mark] || have[mark]) return;
      var r = byId[Number(mark.split("#")[0])] || null;
      var ts = markDate(mark), who = null;
      var label = "Canje: " + rewardName(r);
      log.some(function (e) {
        if (e.type !== "reward" || usedEv[e.id] || isHidden(e) || e.label !== label) return false;
        if (ts && Math.abs(Date.parse(e.ts) - Date.parse(ts)) > 120000) return false;
        usedEv[e.id] = 1; ts = ts || e.ts; who = e.device; return true;
      });
      var c = snapshot(r, mark, ts);
      if (who) c.device = who;
      c.migrado = true;
      list.push(c); have[mark] = 1; added++;
    });
    if (added) localStorage.setItem(CANJES_KEY, JSON.stringify(list));
    return added;
  }
  // Recuerdos que se enseñan: sin anulados (y sin pruebas, salvo dentro del modo Dev)
  function visibleCanjes() {
    var revoked = {}; readArr(REVOKED_KEY).forEach(function (t) { revoked[String(t)] = 1; });
    return readCanjes().filter(function (c) { return !revoked[c.id] && (!c.dev || window.PIVI_DEV); })
      .sort(function (a, b) { return (b.ts || "") < (a.ts || "") ? -1 : (b.ts || "") > (a.ts || "") ? 1 : 0; });
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
    var limit = Number(box.getAttribute("data-limit")) || 14; // Inicio: 5; Recuerdos: 14
    box.innerHTML = log.slice(0, limit).map(function (e) {
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
    trimLog: trimLog,
    summarize: summarize,
    mergeMeses: mergeMeses,
    readMeses: readMeses,
    updateMeses: updateMeses,
    monthKey: monthKey,
    recordCanje: recordCanje,
    ensureCanjes: ensureCanjes,
    readCanjes: readCanjes,
    visibleCanjes: visibleCanjes,
    deviceId: deviceId,
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
