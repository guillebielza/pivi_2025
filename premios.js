/* ============================================================
   premios.js — Página de Premios
   - Solo lo que se puede canjear, agrupado por niveles de precio.
   - Lo que aún no está desbloqueado: una línea "N sorpresas en camino".
   - Lo canjeado sale de aquí (salvo los repetibles) y vive en Recuerdos.
   ============================================================ */
(function () {
  "use strict";
  var P = window.PiviPremios;
  var nivelesEl = document.getElementById("niveles");
  var filtersEl = document.getElementById("filters");
  var FILTER_KEY = "pivi_premios_filtro"; // preferencia de este móvil (no viaja a la nube)
  var filtro = "todos";
  try { filtro = localStorage.getItem(FILTER_KEY) || "todos"; } catch (e) {}

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function plural(w) { return /[aeiouáéíóú]$/i.test(w) ? w + "s" : w + "es"; }

  function setPoints(v) {
    localStorage.setItem("points", String(v));
    if (window.PiviCore && PiviCore.setPointsUI) PiviCore.setPointsUI(v, { bump: true });
    else { var el = document.getElementById("points"); if (el) el.textContent = String(v); }
  }

  /* ---------- ventanas ---------- */
  var popupOverlay = document.getElementById("popupOverlay");
  var popupText = document.getElementById("popupText");
  function popup(text) { popupText.textContent = text; popupOverlay.classList.remove("hidden"); }
  document.getElementById("closePopup").onclick = function () { popupOverlay.classList.add("hidden"); };
  popupOverlay.addEventListener("click", function (e) { if (e.target === popupOverlay) popupOverlay.classList.add("hidden"); });

  var confirmOverlay = document.getElementById("confirmOverlay");
  var pending = null;
  function closeConfirm() { confirmOverlay.classList.add("hidden"); pending = null; }
  function confirmAsk(text, onOk) {
    document.getElementById("confirmText").textContent = text;
    pending = onOk;
    confirmOverlay.classList.remove("hidden");
  }
  document.getElementById("confirmCancel").onclick = closeConfirm;
  document.getElementById("confirmOk").onclick = function () { var f = pending; closeConfirm(); if (f) f(); };
  confirmOverlay.addEventListener("click", function (e) { if (e.target === confirmOverlay) closeConfirm(); });

  /* ---------- pintar ---------- */
  function tile(r, pts) {
    var cls = "reward" + (pts >= r.coste ? " affordable" : "") + (r.repetible ? " repeat" : "");
    var tipo = r.tipo === "Regalo" ? "🎁 Regalo" : "✨ Experiencia";
    var label = "Canjear " + (r.tipo === "Regalo" ? "regalo" : "experiencia") + " sorpresa por " + r.coste + " puntos";
    return '<button type="button" class="' + cls + '" data-id="' + esc(r.id) + '" aria-label="' + esc(label) + '">'
      + '<span class="emoji" aria-hidden="true">' + esc(r.textoBoton) + '</span>'
      + '<span class="tipo">' + tipo + '</span>'
      + '<span class="cost">' + r.coste + ' pts</span>'
      + (r.repetible ? '<span class="repeat-badge" title="Se puede canjear varias veces">🔁</span>' : '')
      + '</button>';
  }

  function render() {
    if (!P) return;
    var pts = P.points();
    var res = P.resumen();
    document.getElementById("saldo").textContent = pts;

    // próximo premio
    var sig = P.siguiente();
    var nextEl = document.getElementById("pzNext");
    if (sig) {
      nextEl.innerHTML = '<div class="pz-next-label">Próximo premio: te faltan <b>' + sig.faltan + '</b> pts</div>'
        + '<div class="progress"><span style="width:' + sig.pct.toFixed(0) + '%"></span></div>';
    } else if (res.disponibles.length) {
      nextEl.innerHTML = '<div class="pz-next-label">🎉 ¡Te llega para cualquier premio!</div>';
    } else {
      nextEl.innerHTML = "";
    }

    // filtros
    document.getElementById("countLlega").textContent = res.alcanzables.length ? "(" + res.alcanzables.length + ")" : "";
    filtersEl.querySelectorAll(".pz-chip").forEach(function (b) {
      var on = b.getAttribute("data-f") === filtro;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });

    // premios por nivel
    var list = res.disponibles.filter(function (r) {
      if (filtro === "llega") return pts >= r.coste;
      if (filtro === "Experiencia" || filtro === "Regalo") return r.tipo === filtro;
      return true;
    });
    var order = P.niveles();
    var groups = {};
    list.forEach(function (r) {
      var n = P.nivelDe(r);
      (groups[n.id] = groups[n.id] || { n: n, items: [] }).items.push(r);
    });
    var html = order.filter(function (n) { return groups[n.id]; }).map(function (n) {
      var g = groups[n.id];
      return '<section class="pz-nivel">'
        + '<header class="pz-nivel-head"><h2>' + esc(n.emoji || "") + ' ' + esc(plural(n.nombre)) + '</h2>'
        + '<span class="pz-nivel-cost">' + n.coste + ' pts</span>'
        + (pts >= n.coste ? '<span class="pz-ok">✓ te llega</span>' : '')
        + '</header>'
        + '<div class="reward-grid">' + g.items.map(function (r) { return tile(r, pts); }).join("") + '</div>'
        + '</section>';
    }).join("");
    if (!html) {
      var msg;
      if (!res.disponibles.length) msg = "Ahora mismo no hay premios para canjear. ¡Pronto habrá sorpresas nuevas! ✨";
      else if (filtro === "llega") msg = sig ? "Aún no te llega ninguno: te faltan " + sig.faltan + " pts para el siguiente 💪" : "Aún no te llega ninguno 💪";
      else msg = "Nada por aquí con este filtro.";
      html = '<div class="pz-empty">' + esc(msg) + '</div>';
    }
    nivelesEl.innerHTML = html;

    // sorpresas en camino
    var soon = document.getElementById("pzSoon");
    soon.classList.toggle("hidden", !res.proximamente);
    document.getElementById("pzSoonN").textContent = res.proximamente + (res.proximamente === 1 ? " sorpresa en camino" : " sorpresas en camino");

    // acceso a Recuerdos
    var sub = document.getElementById("recuerdosSub");
    var n = (window.PiviLedger && PiviLedger.visibleCanjes) ? PiviLedger.visibleCanjes().length : 0;
    if (sub) sub.textContent = n ? n + (n === 1 ? " premio canjeado" : " premios canjeados") + " · con su fecha y quién" : "Lo que canjeéis se guarda aquí, con su fecha";
  }
  window.renderRewards = render; // lo usan cloud-sync (al hidratar), el modo Dev y las correcciones

  /* ---------- canjear ---------- */
  function find(id) {
    var all = P.all();
    for (var i = 0; i < all.length; i++) if (String(all[i].id) === String(id)) return all[i];
    return null;
  }
  function askRedeem(id) {
    var r = find(id);
    if (!r) return;
    if (P.estado(r) !== "disponible") { popup("⛔ Este premio no está disponible ahora mismo."); return; }
    var pts = P.points();
    if (pts < r.coste) { popup("Te faltan " + (r.coste - pts) + " puntos para este premio 💪"); return; }
    confirmAsk("¿Seguro que quieres canjear " + r.textoBoton + " por " + r.coste + " puntos?\n\nTe quedarán " + (pts - r.coste) + " puntos.",
      function () { redeem(r); });
  }
  function redeem(r) {
    var pts = P.points();
    if (P.estado(r) !== "disponible" || pts < r.coste) { render(); return; }
    setPoints(pts - r.coste);
    var mark = P.addRedeemed(r.id);
    if (window.PiviLedger) {
      // recuerdo permanente: una "foto" del premio tal y como era al canjearlo
      if (PiviLedger.recordCanje) PiviLedger.recordCanje(r, mark);
      PiviLedger.record("reward", -r.coste, "Canje: " + P.name(r));
    }
    if (window.PiviCore && PiviCore.celebrateReward) PiviCore.celebrateReward(r.textoBoton);
    else if (window.PiviCore && PiviCore.celebrate) PiviCore.celebrate({ duration: 2400 });
    setTimeout(function () { popup((r.mensajePopup || "✅ Premio canjeado") + "\n\n💞 Guardado en Recuerdos"); }, 650);
    render();
  }

  nivelesEl.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("button[data-id]");
    if (b) askRedeem(b.getAttribute("data-id"));
  });
  filtersEl.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".pz-chip");
    if (!b) return;
    filtro = b.getAttribute("data-f");
    try { localStorage.setItem(FILTER_KEY, filtro); } catch (err) {}
    render();
  });

  // modo Dev: acceso directo al Gestor de premios (añadir, editar, retirar)
  if (window.PIVI_DEV && window.PiviDev && PiviDev.openGestor) {
    var gb = document.createElement("button");
    gb.type = "button";
    gb.className = "btn secondary pz-gestor";
    gb.textContent = "🛠 Gestionar premios";
    gb.addEventListener("click", function () { PiviDev.openGestor(); });
    filtersEl.parentNode.insertBefore(gb, filtersEl);
  }

  window.addEventListener("pivi:hydrated", render);
  window.addEventListener("pivi:canjes", render);
  if (P) {
    P.onChange(render);
    P.load().catch(function () { popup("No se han podido cargar los premios (recompensas.json)."); render(); });
  }
  if (window.PiviCore && PiviCore.setPointsUI) PiviCore.setPointsUI(P ? P.points() : 0);
  render();
})();
