/* ============================================================
   pivi-config.js — TODO lo que mantienes TÚ, en un solo sitio
   ------------------------------------------------------------
   Dos formas de editar:
   1) Edita este archivo y vuelve a publicar la web (valores por
      defecto, iguales en todos los dispositivos).
   2) Usa el editor "📦 Contenido" del modo Dev (🛠) para cambiarlo
      EN CALIENTE: se guarda en Supabase y aparece al instante en
      todos los dispositivos, sin re-publicar.

   La nube (si existe) MANDA sobre este archivo. Si borras la fila de
   la nube, se vuelve a usar lo de aquí.

   🎁 PREMIOS: desde nov-2026 se gestionan en el modo Dev
   («🎁 Gestor de premios»): el catálogo completo y los precios de cada
   nivel se guardan en la nube. recompensas.json (y datos.xlsx) solo
   son la copia inicial que se usa si la nube aún no tiene catálogo.
   ============================================================ */
window.PIVI_CONFIG = {

  /* 🏷️ CÓDIGOS DE RECOMPENSA  →  "CODIGO": puntos que da */
  codigos: {
    "GH10-A1B2": 10, "GH10-C3D4": 10, "GH10-E5F6": 10, "GH10-G7H8": 10,
    "GH10-I9J0": 10, "GH10-K1L2": 10, "GH10-M3N4": 10, "GH10-O5P6": 10,
    "GH15-Q7R8": 15, "GH15-S9T0": 15, "GH15-U1V2": 15, "GH15-W3X4": 15, "GH15-Y5Z6": 15,
    "GH18-AB12": 18, "GH18-CD34": 18, "GH18-EF56": 18,
    "GH22-GH78": 22, "GH22-IJ90": 22, "GH22-KL12": 22,
    "GH50-ULTRA": 50, "PIVI-2026": 25
    // añade los tuyos aquí...
  },

  /* 🎡 RULETA  →  8 sectores (los colores son fijos, los números no) */
  ruleta: [1, 4, 6, 0, 8, 4, 6, 1],

  /* 🛠 PIN del modo desarrollador */
  devPin: "2026",

  /* 🏷️ NIVELES DE PREMIO  →  en la página de Premios se agrupan así.
     Un premio cae en el nivel de su coste. Si algún día hay que
     reajustar la economía, se cambia aquí el precio de cada nivel
     (y el coste de los premios de ese nivel). */
  niveles: [
    { id: "pequeno",  nombre: "Pequeño",  coste: 50,  emoji: "🌱" },
    { id: "mediano",  nombre: "Mediano",  coste: 85,  emoji: "🌷" },
    { id: "grande",   nombre: "Grande",   coste: 135, emoji: "🌟" },
    { id: "especial", nombre: "Especial", coste: 185, emoji: "💎" }
  ],

  /* 🎁 AJUSTES de recompensas por id (override de recompensas.json)
     Ej. para desbloquear la recompensa 8:
       "8": { disponible: true, coste: 125, textoBoton: "🎯",
              mensajePopup: "¡Desbloqueada!", mensajeHistorico: "Dardos disfrutados 🎯" } */
  recompensasOverride: {},

  /* 🔧 AJUSTE PUNTUAL DE PUNTOS: cada dispositivo pone su saldo en "puntos"
     UNA sola vez (la primera vez que abre la web con este "id").
     Para hacer otro ajuste en el futuro, cambia el id y los puntos. */
  ajustePuntos: { id: "2026-11-16", puntos: 150 }
};

/* ---------- ajuste puntual de puntos (una vez por dispositivo) ---------- */
(function () {
  var A = window.PIVI_CONFIG.ajustePuntos;
  if (!A || !A.id) return;
  try {
    var FLAG = "pivi_ajuste_" + A.id;
    if (localStorage.getItem(FLAG)) return;
    localStorage.setItem("points", String(Number(A.puntos) || 0));
    localStorage.setItem(FLAG, new Date().toISOString());
  } catch (e) {}
})();

/* ---------- carga/guardado en la nube (override en caliente) ---------- */
(function () {
  "use strict";
  // capturamos las credenciales ANTES de que el modo Dev anule window.PIVI_CLOUD
  var CLOUD = window.PIVI_CLOUD;
  var DEFAULTS = JSON.parse(JSON.stringify(window.PIVI_CONFIG));
  var TABLE = "pivi_content";

  function headers() {
    var h = { "apikey": CLOUD.anonKey, "Content-Type": "application/json", "x-pivi-profile": CLOUD.profileId };
    if (/^eyJ/.test(CLOUD.anonKey)) h.Authorization = "Bearer " + CLOUD.anonKey; // clave antigua "anon"
    return h;
  }
  function base() {
    var root = CLOUD.url.replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
    return root + "/rest/v1/" + TABLE;
  }

  function apply(ov) {
    if (!ov) return;
    var C = window.PIVI_CONFIG;
    C.codigos = Object.assign({}, DEFAULTS.codigos, ov.codigos || {});
    C.ruleta = (Array.isArray(ov.ruleta) && ov.ruleta.length) ? ov.ruleta.map(Number) : DEFAULTS.ruleta;
    C.devPin = ov.devPin || DEFAULTS.devPin;
    C.recompensasOverride = Object.assign({}, DEFAULTS.recompensasOverride, ov.recompensasOverride || {});
    // catálogo completo de premios y precios por nivel (Gestor de premios)
    C.recompensas = (Array.isArray(ov.recompensas) && ov.recompensas.length) ? ov.recompensas : DEFAULTS.recompensas;
    C.niveles = (Array.isArray(ov.niveles) && ov.niveles.length) ? ov.niveles : DEFAULTS.niveles;
    try { window.dispatchEvent(new CustomEvent("pivi:config")); } catch (e) {}
  }
  function fetchRow() {
    var url = base() + "?id=eq." + encodeURIComponent(CLOUD.profileId) + "&select=*";
    return fetch(url, { headers: headers(), cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (rows) { return rows && rows.length ? (rows[0].content || {}) : null; });
  }

  function load() {
    if (!CLOUD || !CLOUD.url) return Promise.resolve();
    return fetchRow()
      .then(function (content) { if (content) apply(content); })
      .catch(function (e) { if (window.console) console.info("[Pivi config] sin override de nube:", e.message); });
  }

  function current() {
    var C = window.PIVI_CONFIG;
    return { codigos: C.codigos, ruleta: C.ruleta, devPin: C.devPin, recompensasOverride: C.recompensasOverride,
             recompensas: C.recompensas, niveles: C.niveles };
  }

  // Guarda SOLO los campos que se pasan (p. ej. {codigos, ruleta, devPin} o
  // {recompensas, niveles}). Antes lee la nube y mezcla encima, así un editor
  // no borra lo que guardó el otro (ni lo que cambió el otro móvil).
  function save(partial) {
    function strip(o) { var out = {}; Object.keys(o).forEach(function (k) { if (o[k] !== undefined) out[k] = o[k]; }); return out; }
    if (!CLOUD || !CLOUD.url) {
      apply(Object.assign({}, current(), strip(partial))); // sin nube: solo en esta sesión
      return Promise.reject(new Error("Sin nube configurada"));
    }
    return fetchRow().then(function (cloud) {
      var content = Object.assign({}, cloud || current(), strip(partial));
      apply(content); // refleja al instante en este dispositivo
      var body = [{ id: CLOUD.profileId, content: content, updated_at: new Date().toISOString() }];
      var h = Object.assign({}, headers(), { "Prefer": "resolution=merge-duplicates,return=minimal" });
      return fetch(base(), { method: "POST", headers: h, body: JSON.stringify(body) })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); });
    });
  }

  var ready = load(); // la 1.ª lectura de la nube (pivi-premios la espera un momento)
  window.PiviContent = { load: load, save: save, current: current, ready: ready, hasCloud: !!(CLOUD && CLOUD.url) };
})();
