/* ============================================================
   pivi-premios.js — Catálogo de premios, compartido por Inicio,
   Premios y Recuerdos
   ------------------------------------------------------------
   - Carga recompensas.json (+ ajustes de la nube de pivi-config).
   - Niveles de precio (PIVI_CONFIG.niveles): cada premio cae en
     un nivel por su coste (o por su campo "nivel" si lo tiene).
   - Estado de cada premio: "disponible", "proximamente" (aún no
     desbloqueado) o "canjeado" (los de una sola vez; los que tienen
     "repetible": true nunca dejan de estar disponibles).
   - Canjes viejos sin "foto" en Recuerdos: se reconstruyen UNA vez,
     después de leer la nube (PiviLedger.ensureCanjes).
   ============================================================ */
(function () {
  "use strict";

  var DEFAULT_NIVELES = [
    { id: "pequeno", nombre: "Pequeño", coste: 50, emoji: "🌱" },
    { id: "mediano", nombre: "Mediano", coste: 85, emoji: "🌷" },
    { id: "grande", nombre: "Grande", coste: 135, emoji: "🌟" },
    { id: "especial", nombre: "Especial", coste: 185, emoji: "💎" }
  ];

  var catalog = [];
  var loading = null;
  var listeners = [];

  function readArr(k) {
    try { var a = JSON.parse(localStorage.getItem(k)); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function points() { return Number(localStorage.getItem("points")) || 0; }

  function niveles() {
    var n = window.PIVI_CONFIG && PIVI_CONFIG.niveles;
    return (Array.isArray(n) && n.length ? n : DEFAULT_NIVELES).slice().sort(function (a, b) { return a.coste - b.coste; });
  }
  function nivelDe(r) {
    var list = niveles();
    if (r && r.nivel) { for (var i = 0; i < list.length; i++) if (list[i].id === r.nivel) return list[i]; }
    var c = Number(r && r.coste) || 0, best = null;
    list.forEach(function (n) { if (n.coste === c) best = n; });
    if (best) return best;
    list.forEach(function (n) { if (n.coste <= c) best = n; }); // el nivel más alto que no lo supera
    return best || list[0];
  }

  function name(r) {
    if (r && r.mensajeHistorico) return r.mensajeHistorico.split("—")[0].trim();
    return r ? (r.tipo || "Premio") + " de " + r.coste + " pts" : "Premio";
  }

  /* ---------- canjes ---------- */
  // marcas válidas ("6", "6#k3x9…") sin las anuladas
  function marks() {
    var revoked = {};
    readArr("revokedRewards").forEach(function (t) { revoked[String(t)] = 1; });
    return readArr("redeemedRewards").map(String).filter(function (t) { return !revoked[t]; });
  }
  function timesRedeemed(id) {
    return marks().filter(function (t) { return Number(t.split("#")[0]) === Number(id); }).length;
  }
  function addRedeemed(id) {
    var raw = readArr("redeemedRewards");
    var mark = id + "#" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5).padEnd(3, "0");
    raw.push(mark);
    localStorage.setItem("redeemedRewards", JSON.stringify(raw));
    return mark;
  }

  function isAvailable(r) {
    if (window.PIVI_DEV_FORCE_AVAILABLE) return true; // modo Dev: todo disponible
    return !!r && r.disponible !== false;
  }
  function estado(r) {
    if (!r.repetible && timesRedeemed(r.id) > 0) return "canjeado";
    if (!isAvailable(r)) return "proximamente";
    return "disponible";
  }

  /* ---------- resúmenes para Inicio ---------- */
  function resumen() {
    var pts = points(), out = { disponibles: [], alcanzables: [], proximamente: 0, canjeados: 0 };
    catalog.forEach(function (r) {
      var e = estado(r);
      if (e === "canjeado") out.canjeados++;
      else if (e === "proximamente") out.proximamente++;
      else {
        out.disponibles.push(r);
        if (pts >= r.coste) out.alcanzables.push(r);
      }
    });
    out.disponibles.sort(function (a, b) { return a.coste - b.coste; });
    out.alcanzables.sort(function (a, b) { return a.coste - b.coste; });
    return out;
  }
  // el siguiente premio que aún no llega (o null si ya llega a todos)
  function siguiente() {
    var pts = points();
    var locked = resumen().disponibles.filter(function (r) { return r.coste > pts; });
    return locked.length ? { premio: locked[0], faltan: locked[0].coste - pts, pct: Math.max(4, Math.min(100, pts / locked[0].coste * 100)) } : null;
  }

  /* ---------- carga del catálogo ---------- */
  function applyOverrides(data) {
    var ov = (window.PIVI_CONFIG && PIVI_CONFIG.recompensasOverride) || {};
    data.forEach(function (r) { var o = ov[String(r.id)]; if (o) Object.assign(r, o); });
    return data;
  }
  var base = [];
  function rebuild() {
    catalog = applyOverrides(base.map(function (r) { return Object.assign({}, r); }));
  }
  function notify() { listeners.forEach(function (fn) { try { fn(catalog); } catch (e) {} }); }
  function load() {
    if (!loading) {
      loading = fetch("recompensas.json", { cache: "no-cache" })
        .then(function (r) { if (!r.ok) throw new Error("recompensas.json (" + r.status + ")"); return r.json(); })
        .then(function (data) { base = Array.isArray(data) ? data : []; rebuild(); notify(); migrate(); return catalog; });
    }
    return loading;
  }
  function onChange(fn) { listeners.push(fn); if (catalog.length) fn(catalog); }

  // cambios de contenido en caliente (recompensas desde la nube)
  window.addEventListener("pivi:config", function () { if (base.length) { rebuild(); notify(); } });

  /* ---------- canjes antiguos → Recuerdos ---------- */
  var hydrated = !window.PiviSync; // sin nube (o en modo Dev) no hay que esperar
  function migrate() {
    if (!hydrated || !catalog.length || !window.PiviLedger || !PiviLedger.ensureCanjes) return;
    if (PiviLedger.ensureCanjes(catalog)) {
      try { window.dispatchEvent(new CustomEvent("pivi:canjes")); } catch (e) {}
    }
  }
  window.addEventListener("pivi:hydrated", function () {
    if (!hydrated) { hydrated = true; setTimeout(migrate, 0); } // tras la 1.ª lectura de la nube
  });

  window.PiviPremios = {
    load: load, onChange: onChange, all: function () { return catalog; },
    niveles: niveles, nivelDe: nivelDe, name: name, points: points,
    estado: estado, isAvailable: isAvailable, timesRedeemed: timesRedeemed, addRedeemed: addRedeemed,
    resumen: resumen, siguiente: siguiente
  };
})();
