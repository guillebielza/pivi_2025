/* ============================================================
   recuerdos.js — Recuerdos: el histórico permanente de Pivi
   - Cada canje es una "foto" guardada al canjear (PiviLedger,
     clave "pivi_canjes"): no cambia aunque el premio se edite o
     se quite del catálogo.
   - Cada mes tiene su resumen permanente ("pivi_meses"): puntos
     ganados y de dónde salieron, aunque el registro de eventos ya
     se haya recortado.
   ============================================================ */
(function () {
  "use strict";

  var MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio",
    "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  var SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

  var timelineEl = document.getElementById("timeline");

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function monthTitle(key) {
    var p = key.split("-");
    return MONTHS[Number(p[1]) - 1] + " " + p[0];
  }
  function shortMonth(key) {
    var p = key.split("-");
    return SHORT[Number(p[1]) - 1] + " " + p[0];
  }
  function dayLabel(ts) {
    var d = new Date(ts);
    return d.getDate() + " " + SHORT[d.getMonth()];
  }
  function fmt(n) { return Number(n || 0).toLocaleString("es-ES"); }

  function setPointsUI() {
    var v = Number(localStorage.getItem("points")) || 0;
    if (window.PiviCore && PiviCore.setPointsUI) PiviCore.setPointsUI(v);
    else { var el = document.getElementById("points"); if (el) el.textContent = String(v); }
  }

  function render() {
    if (!timelineEl || !window.PiviLedger) return;
    var L = window.PiviLedger;
    var canjes = L.visibleCanjes ? L.visibleCanjes() : [];
    // el resumen se recalcula con lo que haya en el registro (por si aún no se guardó)
    var meses = L.mergeMeses(L.readMeses(), L.summarize(L.readLog()));
    var me = L.deviceId ? L.deviceId() : null;

    // ---- contadores ----
    var ganado = 0;
    Object.keys(meses).forEach(function (m) { ganado += Number(meses[m].ganado) || 0; });
    var months = {};
    Object.keys(meses).forEach(function (m) { months[m] = 1; });
    var sinFecha = [];
    var porMes = {};
    canjes.forEach(function (c) {
      if (!c.ts) { sinFecha.push(c); return; }
      var m = L.monthKey(c.ts);
      months[m] = 1;
      (porMes[m] = porMes[m] || []).push(c);
    });
    var keys = Object.keys(months).sort().reverse();
    document.getElementById("statCanjes").textContent = fmt(canjes.length);
    document.getElementById("statCanjesLabel").textContent = canjes.length === 1 ? "recuerdo" : "recuerdos";
    document.getElementById("statGanado").textContent = fmt(ganado);
    document.getElementById("statDesde").textContent = keys.length ? shortMonth(keys[keys.length - 1]) : "—";

    // ---- línea del tiempo ----
    if (!keys.length && !sinFecha.length) {
      timelineEl.innerHTML = '<div class="rec-empty"><span aria-hidden="true">✨</span>'
        + '<p><b>Aquí empezará vuestra historia.</b><br>Cada premio que canjeéis se quedará guardado con su fecha.</p></div>';
      return;
    }
    var html = keys.map(function (m) {
      return monthBlock(monthTitle(m), meses[m], porMes[m] || [], me);
    }).join("");
    if (sinFecha.length) html += monthBlock("Sin fecha", null, sinFecha, me, "De antes de que Pivi guardara las fechas");
    timelineEl.innerHTML = html;
  }

  function monthBlock(title, s, items, me, note) {
    var chips = [];
    if (s) {
      if (s.ganado) chips.push('<span class="rec-chip pos">+' + fmt(s.ganado) + ' pts</span>');
      if (s.ruleta) chips.push('<span class="rec-chip">🎡 ' + fmt(s.ruleta) + '</span>');
      if (s.retos) chips.push('<span class="rec-chip">🎮 ' + fmt(s.retos) + (s.retosN ? ' · ' + s.retosN + (s.retosN === 1 ? ' reto' : ' retos') : '') + '</span>');
      if (s.codigos) chips.push('<span class="rec-chip">🏷️ ' + fmt(s.codigos) + '</span>');
    }
    if (items.length) chips.push('<span class="rec-chip">🎁 ' + items.length + (items.length === 1 ? ' canje' : ' canjes') + '</span>');
    var list = items.length
      ? '<ul class="rec-list">' + items.map(function (c) { return itemHtml(c, me); }).join("") + '</ul>'
      : '<p class="rec-none">Este mes no hubo canjes: puntos a la hucha ✨</p>';
    return '<section class="rec-month">'
      + '<header class="rec-month-head"><h2>' + esc(title) + '</h2>'
      + (note ? '<span class="rec-note">' + esc(note) + '</span>' : '')
      + (chips.length ? '<div class="rec-chips">' + chips.join("") + '</div>' : '')
      + '</header>' + list + '</section>';
  }

  function itemHtml(c, me) {
    var meta = [];
    if (c.ts) meta.push(dayLabel(c.ts));
    if (c.coste) meta.push(fmt(c.coste) + " pts");
    if (c.device) meta.push(c.device === me ? "tú" : "pareja");
    if (c.dev) meta.push("🛠 prueba");
    return '<li class="rec-item">'
      + '<span class="rec-emoji" aria-hidden="true">' + esc(c.emoji || "🎁") + '</span>'
      + '<div class="rec-body">'
      + '<div class="rec-name">' + esc(c.nombre || "Premio") + '</div>'
      + (c.detalle ? '<div class="rec-detail">' + esc(c.detalle) + '</div>' : '')
      + (meta.length ? '<div class="rec-meta">' + esc(meta.join(" · ")) + '</div>' : '')
      + '</div></li>';
  }

  // Canjes sin "foto" (anteriores a Recuerdos): pivi-premios.js los reconstruye
  // con el catálogo tras la 1.ª lectura de la nube y avisa con "pivi:canjes"
  window.addEventListener("pivi:canjes", render);
  if (window.PiviPremios) PiviPremios.load().catch(function () {});

  window.addEventListener("pivi:hydrated", function () { setPointsUI(); render(); });

  setPointsUI();
  render();
})();
