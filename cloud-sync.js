/* ============================================================
   cloud-sync.js  —  Guardado de puntos en cualquier dispositivo
   ------------------------------------------------------------
   Sincroniza el estado del juego (puntos, recompensas canjeadas,
   códigos usados y los candados de ruleta/retos) con una base de
   datos en la nube (Supabase), de forma que da igual desde qué
   móvil/ordenador entres: siempre verás los mismos puntos.

   DISEÑO (offline-first):
   - localStorage sigue siendo la fuente inmediata: la web carga al
     instante y funciona aunque no haya internet.
   - Al cargar, se descarga el estado de la nube y, si es más
     reciente, se aplica encima del local y se refresca la pantalla.
   - Cada vez que cambia algo importante, se sube a la nube (con un
     pequeño retardo para agrupar cambios).
   - Conflictos: gana la última escritura (por marca de tiempo).
     Suficiente para 1-2 personas; ver PROPUESTA.md.

   SIN CONFIGURACIÓN -> este script no hace nada y la web se comporta
   exactamente igual que antes (solo localStorage en ese dispositivo).
   ============================================================ */
(function () {
  "use strict";

  var cfg = window.PIVI_CLOUD || {};
  var ENABLED = !!(cfg.url && cfg.anonKey && cfg.profileId);

  // Claves de localStorage que viajan a la nube
  var EXACT_KEYS = ["points", "redeemedRewards", "revokedRewards", "usedCodes", "activityLog", "pivi_streak", "pivi_fixes"];
  var PREFIXES = ["wheel_spin_", "weekend_played_", "weekend_rewarded_"];
  var META_UPDATED = "pivi_updated_at";

  // Claves que se fusionan por UNIÓN (nunca se pierde nada al sincronizar)
  var UNION_ARRAYS = ["redeemedRewards", "revokedRewards", "usedCodes", "pivi_fixes"];
  function isLockKey(k) {
    return k.indexOf("wheel_spin_") === 0 || k.indexOf("weekend_played_") === 0 || k.indexOf("weekend_rewarded_") === 0;
  }

  // Accesos "crudos" al storage (sin pasar por nuestro parche).
  // Se toman de Storage.prototype: en Safari/Firefox no se puede cambiar
  // localStorage.setItem directamente (guarda la función como un dato).
  var SP = Storage.prototype;
  var N = { get: SP.getItem, set: SP.setItem, rem: SP.removeItem, clear: SP.clear };
  function rawGet(k) { return N.get.call(localStorage, k); }
  function rawSet(k, v) { return N.set.call(localStorage, k, v); }
  function rawRemove(k) { return N.rem.call(localStorage, k); }
  function rawClear() { return N.clear.call(localStorage); }

  function isTracked(k) {
    if (!k) return false;
    if (EXACT_KEYS.indexOf(k) !== -1) return true;
    for (var i = 0; i < PREFIXES.length; i++) {
      if (k.indexOf(PREFIXES[i]) === 0) return true;
    }
    return false;
  }

  if (!ENABLED) {
    // Modo local puro: no tocamos nada. La web funciona igual que siempre.
    if (window.console && console.info) {
      console.info("[Pivi sync] desactivado (edita cloud-config.js para activar el guardado en la nube).");
    }
    return;
  }

  /* ---------- parche de localStorage: detecta cambios ---------- */
  var hydrating = false; // true mientras aplicamos datos de la nube (no re-subir)
  var ready = false;     // false hasta que la 1ª sincronización decide quién manda.
                         // Evita que las escrituras de arranque (p.ej. setPoints(getPoints()))
                         // se cuenten como "cambios" y pisen lo que hay en la nube.

  // En el prototipo y solo para localStorage (así también funciona en el iPhone)
  SP.setItem = function (k, v) {
    var r = N.set.call(this, k, v);
    if (this === window.localStorage && ready && !hydrating && isTracked(k)) onLocalChange();
    return r;
  };
  SP.removeItem = function (k) {
    var r = N.rem.call(this, k);
    if (this === window.localStorage && ready && !hydrating && isTracked(k)) onLocalChange();
    return r;
  };
  SP.clear = function () {
    var r = N.clear.call(this);
    if (this === window.localStorage && ready && !hydrating) onLocalChange();
    return r;
  };

  /* ---------- helpers de estado ---------- */
  function collectState() {
    var state = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (isTracked(k)) state[k] = rawGet(k);
    }
    return state;
  }

  function applyCloudState(state, ts) {
    hydrating = true;
    try {
      // Quitar claves rastreadas que ya no existen en la nube
      var existing = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (isTracked(k)) existing.push(k);
      }
      existing.forEach(function (k) {
        if (!(k in state)) rawRemove(k);
      });
      // Escribir las de la nube
      Object.keys(state).forEach(function (k) {
        if (isTracked(k)) rawSet(k, String(state[k]));
      });
      rawSet(META_UPDATED, ts);
    } finally {
      hydrating = false;
    }
    refreshUI();
    try {
      window.dispatchEvent(new CustomEvent("pivi:hydrated"));
    } catch (_) {}
  }

  function refreshUI() {
    var ptsEl = document.getElementById("points");
    if (ptsEl) ptsEl.textContent = rawGet("points") || "0";
    // En index.html existe renderRewards(); refrescamos la lista de canjeos
    if (typeof window.renderRewards === "function") {
      try { window.renderRewards(); } catch (_) {}
    }
  }

  /* ---------- fusión de estados (CRDT sencillo) ----------
     En vez de "gana la última escritura" sobre TODO el estado
     (que perdía canjeos/códigos si dos dispositivos jugaban a la
     vez), fusionamos campo a campo:
       - redeemedRewards / usedCodes -> unión (conjuntos que crecen)
       - activityLog                 -> unión por id de evento
       - candados de día (locks)     -> fecha más reciente
       - pivi_streak                 -> mayor racha / día más reciente
       - points                      -> lo de la NUBE + lo que este
         dispositivo ha ganado/gastado y aún no ha subido (eventos
         "pendientes" que apunta pivi-ledger.js). Así, si los dos
         jugáis a la vez, se suman los puntos de ambos en vez de
         quedarse solo con los del último que guardó.
  */
  var PENDING_KEY = "pivi_pending_ev"; // local: ids de eventos aún no subidos
  function pendingIds() { return parseArr(rawGet(PENDING_KEY)); }
  function pendingDelta(localState, cloudState) {
    var pend = {};
    pendingIds().forEach(function (id) { pend[id] = 1; });
    var inCloud = {};
    parseArr(cloudState && cloudState.activityLog).forEach(function (ev) { if (ev && ev.id) inCloud[ev.id] = 1; });
    var sum = 0;
    parseArr(localState && localState.activityLog).forEach(function (ev) {
      if (!ev || !pend[ev.id] || inCloud[ev.id]) return;
      if (ev.dev || isVoidEvent(ev.id)) return; // pruebas del modo Dev / anulados: nunca suman
      sum += Number(ev.delta) || 0;
    });
    return sum;
  }
  function isVoidEvent(id) {
    return !!(window.PiviLedger && PiviLedger.isVoid && PiviLedger.isVoid(id));
  }
  // Un evento deja de estar pendiente cuando lo VEMOS en la nube al
  // leerla (no basta con haberlo subido: si el otro dispositivo
  // escribió a la vez, nuestra subida pudo quedar pisada y entonces
  // se vuelve a sumar en la siguiente sincronización).
  function clearPending(cloudState, localState) {
    var pend = pendingIds();
    if (!pend.length) return;
    var seen = {}, mine = {};
    parseArr(cloudState && cloudState.activityLog).forEach(function (ev) { if (ev && ev.id) seen[ev.id] = 1; });
    parseArr(localState && localState.activityLog).forEach(function (ev) { if (ev && ev.id) mine[ev.id] = 1; });
    var left = pend.filter(function (id) { return !seen[id] && mine[id] && !isVoidEvent(id); });
    if (left.length === pend.length) return;
    if (left.length) rawSet(PENDING_KEY, JSON.stringify(left));
    else rawRemove(PENDING_KEY);
  }
  function parseArr(v) {
    try { var a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch (_) { return []; }
  }
  function unionArray(localStr, cloudStr) {
    var seen = {}, out = [];
    parseArr(localStr).concat(parseArr(cloudStr)).forEach(function (x) {
      var k = String(x);
      if (!seen[k]) { seen[k] = 1; out.push(x); }
    });
    return JSON.stringify(out);
  }
  function unionLog(localStr, cloudStr) {
    var seen = {}, out = [];
    parseArr(localStr).concat(parseArr(cloudStr)).forEach(function (ev) {
      if (ev && ev.dev) return; // lo hecho en modo Dev nunca viaja a la nube
      if (ev && ev.id && !seen[ev.id]) { seen[ev.id] = 1; out.push(ev); }
    });
    out.sort(function (a, b) { return (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0); });
    return JSON.stringify(out.slice(-80));
  }
  function mergeStreak(localStr, cloudStr) {
    var a, b;
    try { a = JSON.parse(localStr); } catch (_) {}
    try { b = JSON.parse(cloudStr); } catch (_) {}
    if (!a) return cloudStr || localStr;
    if (!b) return localStr || cloudStr;
    var winner = (String(b.lastDay) > String(a.lastDay)) ? b
      : (String(a.lastDay) > String(b.lastDay)) ? a
      : (Number(b.count) > Number(a.count) ? b : a);
    return JSON.stringify(winner);
  }
  function mergeStates(localState, cloudState, cloudNewer) {
    var keys = {}, out = {};
    Object.keys(localState || {}).forEach(function (k) { keys[k] = 1; });
    Object.keys(cloudState || {}).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var lv = localState ? localState[k] : undefined;
      var cv = cloudState ? cloudState[k] : undefined;
      if (UNION_ARRAYS.indexOf(k) !== -1) {
        out[k] = unionArray(lv, cv);
      } else if (k === "activityLog") {
        out[k] = unionLog(lv, cv);
      } else if (k === "pivi_streak") {
        out[k] = mergeStreak(lv, cv);
      } else if (isLockKey(k)) {
        out[k] = (String(cv || "") > String(lv || "")) ? cv : (lv != null ? lv : cv); // fecha mayor
      } else if (k === "points" && cv != null) {
        out[k] = String((Number(cv) || 0) + pendingDelta(localState, cloudState));
      } else { // otros escalares -> última escritura
        if (lv == null) out[k] = cv;
        else if (cv == null) out[k] = lv;
        else out[k] = cloudNewer ? cv : lv;
      }
    });
    return out;
  }

  /* ---------- red (Supabase REST) ---------- */
  // Admite la URL con o sin "/rest/v1" final (error frecuente al copiarla)
  var ROOT = cfg.url.replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
  var BASE = ROOT + "/rest/v1/" + (cfg.table || "pivi_state");
  var HEADERS = {
    "apikey": cfg.anonKey,
    "Content-Type": "application/json",
    "x-pivi-profile": cfg.profileId   // la base de datos solo deja tocar la fila de este perfil
  };
  // Las claves antiguas ("anon", empiezan por eyJ) van también como Bearer;
  // las nuevas (sb_publishable_…) solo en "apikey".
  if (/^eyJ/.test(cfg.anonKey)) HEADERS.Authorization = "Bearer " + cfg.anonKey;

  function cloudGet() {
    var url = BASE + "?profile_id=eq." + encodeURIComponent(cfg.profileId) + "&select=*";
    return fetch(url, { headers: HEADERS, cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("GET HTTP " + r.status);
      return r.json();
    });
  }

  function cloudUpsert(state, ts) {
    var body = [{ profile_id: cfg.profileId, state: state, updated_at: ts }];
    var h = Object.assign({}, HEADERS, { "Prefer": "resolution=merge-duplicates,return=minimal" });
    return fetch(BASE, { method: "POST", headers: h, body: JSON.stringify(body), keepalive: true }).then(function (r) {
      if (!r.ok) throw new Error("UPSERT HTTP " + r.status);
    });
  }

  /* ---------- subida con retardo (debounce) ---------- */
  var pushTimer = null;
  var pushPending = false;

  function onLocalChange() {
    rawSet(META_UPDATED, new Date().toISOString());
    schedulePush();
  }

  var holdUntil = 0; // p. ej. mientras gira la ruleta: no subir (ni refrescar) hasta que pare
  function schedulePush() {
    pushPending = true;
    setBadge("saving");
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, Math.max(700, holdUntil - Date.now()));
  }
  function holdPush(ms) {
    holdUntil = Date.now() + (Number(ms) || 0);
    if (pushPending) schedulePush();
  }

  // Subir = leer la nube, fusionar y escribir el resultado (nunca se
  // pisa a ciegas lo que haya subido el otro dispositivo).
  function push() {
    clearTimeout(pushTimer);
    pushPending = false;
    return sync(true);
  }

  /* ---------- descarga + FUSIÓN (+ subida si hace falta) ---------- */
  function filterTracked(state) {
    var out = {};
    Object.keys(state || {}).forEach(function (k) { if (isTracked(k)) out[k] = state[k]; });
    return out;
  }

  var syncing = null;      // promesa en curso (no se solapan dos sincronizaciones)
  var syncAgain = false;   // hubo cambios mientras sincronizábamos -> repetir al acabar
  var syncAgainPush = false;

  function sync(forcePush) {
    if (syncing) {
      syncAgain = true;
      syncAgainPush = syncAgainPush || !!forcePush;
      return syncing;
    }
    syncing = cloudGet().then(function (rows) {
      var localState = collectState();
      var localTs = rawGet(META_UPDATED);
      var localMs = localTs ? Date.parse(localTs) : 0;
      var rec = rows && rows.length ? rows[0] : null;
      var merged, ts, needPush;

      if (rec) {
        var cloudState = filterTracked(rec.state || {});
        var cloudMs = rec.updated_at ? Date.parse(rec.updated_at) : 0;
        var cloudNewer = cloudMs >= localMs;
        merged = mergeStates(localState, cloudState, cloudNewer);
        clearPending(cloudState, localState);
        ts = (cloudNewer && rec.updated_at) ? rec.updated_at : (localTs || new Date().toISOString());
        // aplica la fusión en este dispositivo (refresca puntos y UI)
        applyCloudState(merged, ts);
        needPush = forcePush || JSON.stringify(merged) !== JSON.stringify(cloudState);
      } else {
        // No hay registro aún: creamos el primero con lo que haya local
        merged = localState;
        ts = localTs || new Date().toISOString();
        rawSet(META_UPDATED, ts);
        needPush = true;
      }
      ready = true; // a partir de aquí, los cambios del usuario sí se suben

      if (!needPush) { setBadge("saved"); return; }
      if (forcePush) ts = new Date().toISOString();
      return cloudUpsert(merged, ts).then(function () { setBadge("saved"); });
    }).catch(function (e) {
      ready = true; // sin conexión: los cambios quedan pendientes y se reintentan
      pushPending = pushPending || !!forcePush || pendingIds().length > 0;
      setBadge("error");
      console.warn("[Pivi sync] no se pudo sincronizar con la nube:", e.message);
    }).then(function () {
      syncing = null;
      if (syncAgain) {
        var p = syncAgainPush;
        syncAgain = syncAgainPush = false;
        return sync(p);
      }
    });
    return syncing;
  }

  function hydrate() { return sync(false); }

  /* ---------- indicador visual (se inyecta solo) ---------- */
  var badgeEl = null;
  var BADGE_TEXT = {
    saving: "☁️ guardando…",
    saved: "☁️ sincronizado",
    error: "⚠️ sin conexión"
  };
  var BADGE_BG = { saving: "#fdffb6", saved: "#caffbf", error: "#ffadad" };

  function ensureBadge() {
    if (badgeEl || !document.body) return;
    badgeEl = document.createElement("div");
    badgeEl.id = "piviSyncBadge";
    badgeEl.style.cssText = [
      "position:fixed", "bottom:calc(10px + var(--bottom-ui, 0px))",
      "right:max(10px, env(safe-area-inset-right, 0px))", "z-index:1000",
      "font:600 12px/1 sans-serif", "color:#3a2a1f",
      "padding:7px 10px", "border-radius:999px",
      "box-shadow:0 2px 6px rgba(0,0,0,.18)", "opacity:.92",
      "pointer-events:none", "user-select:none", "transition:background .2s"
    ].join(";");
    document.body.appendChild(badgeEl);
  }

  function setBadge(state) {
    ensureBadge();
    if (!badgeEl) return;
    badgeEl.textContent = BADGE_TEXT[state] || "";
    badgeEl.setAttribute("data-state", state);
    badgeEl.style.background = BADGE_BG[state] || "#eee";
  }

  /* ---------- arranque ---------- */
  function start() {
    ensureBadge();
    setBadge("saving");
    hydrate();

    // Refresco periódico: ver cambios hechos desde otro dispositivo
    setInterval(function () {
      if (!pushPending && !document.hidden && Date.now() > holdUntil) hydrate();
    }, 30000);

    // Al volver a la app, sincroniza; al irse a segundo plano, sube lo pendiente
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { if (pushPending) { try { push(); } catch (_) {} } }
      else if (!pushPending) hydrate();
    });

    // Intento de guardado final al salir (si no llega, lo pendiente se
    // sube la próxima vez que se abra la web: no se pierde)
    window.addEventListener("pagehide", function () {
      if (pushPending) { try { push(); } catch (_) {} }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  // API mínima por si quieres forzar acciones desde la consola
  window.PiviSync = { hydrate: hydrate, push: push, state: collectState, holdPush: holdPush, _merge: mergeStates };
})();
