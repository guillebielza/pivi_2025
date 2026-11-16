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
  var EXACT_KEYS = ["points", "redeemedRewards", "usedCodes", "activityLog", "pivi_streak"];
  var PREFIXES = ["wheel_spin_", "weekend_played_", "weekend_rewarded_"];
  var META_UPDATED = "pivi_updated_at";

  // Claves que se fusionan por UNIÓN (nunca se pierde nada al sincronizar)
  var UNION_ARRAYS = ["redeemedRewards", "usedCodes"];
  function isLockKey(k) {
    return k.indexOf("wheel_spin_") === 0 || k.indexOf("weekend_played_") === 0 || k.indexOf("weekend_rewarded_") === 0;
  }

  // Accesos "crudos" al storage (sin pasar por nuestro parche)
  var rawGet = localStorage.getItem.bind(localStorage);
  var rawSet = localStorage.setItem.bind(localStorage);
  var rawRemove = localStorage.removeItem.bind(localStorage);
  var rawClear = localStorage.clear.bind(localStorage);

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

  localStorage.setItem = function (k, v) {
    rawSet(k, v);
    if (ready && !hydrating && isTracked(k)) onLocalChange();
  };
  localStorage.removeItem = function (k) {
    rawRemove(k);
    if (ready && !hydrating && isTracked(k)) onLocalChange();
  };
  localStorage.clear = function () {
    rawClear();
    if (ready && !hydrating) onLocalChange();
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
       - points                      -> gana la marca de tiempo más nueva
  */
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
      } else { // points u otros escalares -> última escritura
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
    "Authorization": "Bearer " + cfg.anonKey,
    "Content-Type": "application/json"
  };

  function cloudGet() {
    var url = BASE + "?profile_id=eq." + encodeURIComponent(cfg.profileId) + "&select=*";
    return fetch(url, { headers: HEADERS, cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("GET HTTP " + r.status);
      return r.json();
    });
  }

  function cloudUpsert() {
    var body = [{
      profile_id: cfg.profileId,
      state: collectState(),
      updated_at: rawGet(META_UPDATED) || new Date().toISOString()
    }];
    var h = Object.assign({}, HEADERS, { "Prefer": "resolution=merge-duplicates,return=minimal" });
    return fetch(BASE, { method: "POST", headers: h, body: JSON.stringify(body) }).then(function (r) {
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

  function schedulePush() {
    pushPending = true;
    setBadge("saving");
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 700);
  }

  function push() {
    clearTimeout(pushTimer);
    pushPending = false;
    cloudUpsert()
      .then(function () { setBadge("saved"); })
      .catch(function (e) {
        pushPending = true; // reintentaremos en el próximo cambio / recarga
        setBadge("error");
        console.warn("[Pivi sync] no se pudo guardar en la nube:", e.message);
      });
  }

  /* ---------- descarga + FUSIÓN ---------- */
  function filterTracked(state) {
    var out = {};
    Object.keys(state || {}).forEach(function (k) { if (isTracked(k)) out[k] = state[k]; });
    return out;
  }

  function hydrate() {
    return cloudGet().then(function (rows) {
      var localState = collectState();
      var localTs = rawGet(META_UPDATED);
      var localMs = localTs ? Date.parse(localTs) : 0;

      if (rows && rows.length) {
        var rec = rows[0];
        var cloudState = filterTracked(rec.state || {});
        var cloudMs = rec.updated_at ? Date.parse(rec.updated_at) : 0;
        var cloudNewer = cloudMs >= localMs;

        var merged = mergeStates(localState, cloudState, cloudNewer);
        var newerTs = (cloudNewer && rec.updated_at) ? rec.updated_at : (localTs || new Date().toISOString());

        var changedCloud = JSON.stringify(merged) !== JSON.stringify(cloudState);

        // aplica la fusión en este dispositivo (refresca puntos y UI)
        applyCloudState(merged, newerTs);
        ready = true;

        if (changedCloud) push();          // la nube no tenía todo -> súbelo fusionado
        else setBadge("saved");
      } else {
        // No hay registro aún: creamos el primero con lo que haya local
        if (!localTs) rawSet(META_UPDATED, new Date().toISOString());
        ready = true;
        push();
      }
      ready = true; // a partir de aquí, los cambios del usuario sí se suben
    }).catch(function (e) {
      ready = true; // sin conexión: dejamos que los cambios se encolen y reintenten
      setBadge("error");
      console.warn("[Pivi sync] no se pudo leer de la nube:", e.message);
    });
  }

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
      "position:fixed", "bottom:10px", "right:10px", "z-index:1000",
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
    badgeEl.style.background = BADGE_BG[state] || "#eee";
  }

  /* ---------- arranque ---------- */
  function start() {
    ensureBadge();
    setBadge("saving");
    hydrate();

    // Refresco periódico: ver cambios hechos desde otro dispositivo
    setInterval(function () {
      if (!pushPending) hydrate();
    }, 30000);

    // Al volver a la pestaña, sincroniza
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && !pushPending) hydrate();
    });

    // Intento de guardado final al salir
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
  window.PiviSync = { hydrate: hydrate, push: push, state: collectState };
})();
