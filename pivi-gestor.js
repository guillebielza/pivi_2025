/* ============================================================
   pivi-gestor.js — 🎁 Gestor de premios (solo modo Dev)
   ------------------------------------------------------------
   Se carga al abrirlo desde el panel 🛠 (o desde Premios en modo Dev).
   - Añadir, editar, poner "próximamente" (pausar) o retirar premios.
   - Cada premio va en un NIVEL; su precio es el del nivel. Cambiar el
     precio de un nivel cambia el de todos sus premios.
   - Guardar escribe el catálogo COMPLETO en la nube (pivi_content) y
     aparece al momento en los dos móviles. Los ids nunca se reutilizan:
     un premio se retira, no se borra.
   - Copia de seguridad: descargar / restaurar el catálogo en JSON.
   Lo ya canjeado no cambia: Recuerdos guarda su propia "foto".
   ============================================================ */
(function () {
  "use strict";
  if (window.PiviGestor) return;

  var TIPOS = ["Experiencia", "Regalo"];
  var ESTADOS = [
    { id: "disponible", label: "✅ Disponible", hint: "Se ve en Premios y se puede canjear" },
    { id: "proximamente", label: "⏳ Próximamente", hint: "Cuenta como «sorpresa en camino»" },
    { id: "retirado", label: "🗄️ Retirado", hint: "No se ve en ningún sitio (sus recuerdos se quedan)" }
  ];

  var items = [], levels = [], dirty = false, tab = "disponible", openId = null, root = null;

  /* ---------- utilidades ---------- */
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "style") e.style.cssText = attrs[k];
      else if (k === "text") e.textContent = attrs[k];
      else if (k.indexOf("on") === 0) e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function btnCss(bg, fg) {
    return "border:none;border-radius:9px;padding:8px 11px;font:700 12.5px system-ui;cursor:pointer;" +
      "background:" + (bg || "#322530") + ";color:" + (fg || "#ffe9e2") + ";";
  }
  var INP = "box-sizing:border-box;width:100%;background:#251d24;color:#fff;border:1px solid #4a3645;border-radius:9px;padding:8px;font:600 13px system-ui;";
  function toast(t, ms) { if (window.PiviCore && PiviCore.toast) PiviCore.toast(t, ms || 2400); }
  function splitHist(h) {
    h = h || "";
    var i = h.indexOf("—");
    return i >= 0 ? { nombre: h.slice(0, i).trim(), detalle: h.slice(i + 1).trim() } : { nombre: h.trim(), detalle: "" };
  }
  function estadoDe(r) { return r.retirado ? "retirado" : (r.disponible === false ? "proximamente" : "disponible"); }
  function setEstado(r, e) { r.retirado = e === "retirado"; r.disponible = e === "disponible"; }
  function levelById(id) { for (var i = 0; i < levels.length; i++) if (levels[i].id === id) return levels[i]; return levels[0]; }
  function timesRedeemed(id) { return (window.PiviPremios && PiviPremios.timesRedeemed) ? PiviPremios.timesRedeemed(id) : 0; }
  function markDirty() { dirty = true; var s = document.getElementById("pgDirty"); if (s) s.textContent = "● Cambios sin guardar"; }

  /* ---------- datos ---------- */
  function normalize(list) {
    return (list || []).filter(function (r) { return r && r.id != null; }).map(function (r) {
      var n = clone(r);
      n.id = Number(n.id);
      n.tipo = TIPOS.indexOf(n.tipo) >= 0 ? n.tipo : "Experiencia";
      n.textoBoton = n.textoBoton || "🎁";
      var lv = (window.PiviPremios && PiviPremios.nivelDe) ? PiviPremios.nivelDe(n) : levels[0];
      n.nivel = (lv && lv.id) || (levels[0] && levels[0].id);
      n.disponible = n.disponible !== false;
      n.retirado = !!n.retirado;
      n.repetible = !!n.repetible;
      n.mensajePopup = n.mensajePopup || "";
      n.mensajeHistorico = n.mensajeHistorico || "";
      return n;
    }).sort(function (a, b) { return a.id - b.id; });
  }
  function loadData() {
    var P = window.PiviPremios;
    levels = clone(P ? P.niveles() : ((window.PIVI_CONFIG && PIVI_CONFIG.niveles) || []));
    return (P ? P.load() : Promise.resolve()).then(function () {
      items = normalize(P ? P.allWithRetired() : []);
    });
  }

  /* ---------- pintar ---------- */
  function counts() {
    var c = { disponible: 0, proximamente: 0, retirado: 0 };
    items.forEach(function (r) { c[estadoDe(r)]++; });
    return c;
  }
  function render() {
    var body = document.getElementById("pgBody");
    if (!body) return;
    body.innerHTML = "";

    // --- niveles ---
    body.appendChild(el("div", { style: "margin:4px 0 6px;color:#b094a0;font-weight:800;font-size:11px;letter-spacing:.3px", text: "🏷️ NIVELES · el precio de cada nivel vale para todos sus premios" }));
    var lvBox = el("div", { style: "display:grid;gap:6px;margin-bottom:14px" });
    levels.forEach(function (lv) {
      var emoji = el("input", { maxlength: "4", style: INP + "text-align:center;padding:8px 2px" });
      emoji.value = lv.emoji || "";
      emoji.addEventListener("input", function () { lv.emoji = emoji.value.trim(); markDirty(); });
      var nombre = el("input", { style: INP });
      nombre.value = lv.nombre || "";
      nombre.addEventListener("input", function () { lv.nombre = nombre.value.trim(); markDirty(); renderList(); });
      var coste = el("input", { type: "number", min: "1", step: "1", inputmode: "numeric", style: INP + "padding:8px 6px" });
      coste.value = lv.coste;
      coste.addEventListener("input", function () { lv.coste = Math.round(Number(coste.value)) || 0; markDirty(); renderList(); });
      var n = items.filter(function (r) { return r.nivel === lv.id && !r.retirado; }).length;
      lvBox.appendChild(el("div", { style: "display:grid;grid-template-columns:44px minmax(0,1fr) 70px 64px;gap:6px;align-items:center" }, [
        emoji, nombre, coste, el("span", { style: "font-size:11px;opacity:.7", text: "pts · " + n + (n === 1 ? " premio" : " premios") })
      ]));
    });
    body.appendChild(lvBox);

    // --- pestañas + nuevo ---
    var c = counts();
    var TAB_TXT = { disponible: "✅ Disponibles", proximamente: "⏳ Próximos", retirado: "🗄️ Retirados" };
    var tabs = el("div", { style: "display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-bottom:8px" });
    ESTADOS.forEach(function (e) {
      var on = tab === e.id;
      tabs.appendChild(el("button", {
        type: "button", title: e.hint,
        style: btnCss(on ? "#ff8598" : "#322530", on ? "#2a1016" : "#ffe9e2") + "padding:8px 4px;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis",
        onclick: function () { tab = e.id; openId = null; render(); }
      }, [TAB_TXT[e.id] + " " + c[e.id]]));
    });
    body.appendChild(tabs);
    body.appendChild(el("button", { type: "button", style: btnCss("#8ac926", "#0f2a0a") + "width:100%;margin-bottom:10px", onclick: addNew }, ["＋ Nuevo premio"]));
    body.appendChild(el("div", { id: "pgList" }));
    renderList();
  }

  function renderList() {
    var box = document.getElementById("pgList");
    if (!box) return;
    box.innerHTML = "";
    var list = items.filter(function (r) { return estadoDe(r) === tab; });
    if (!list.length) {
      box.appendChild(el("div", { style: "opacity:.7;padding:14px;text-align:center;border:1px dashed #4a3645;border-radius:10px", text: "No hay premios aquí." }));
      return;
    }
    list.forEach(function (r) { box.appendChild(row(r)); });
  }

  function row(r) {
    var lv = levelById(r.nivel);
    var h = splitHist(r.mensajeHistorico);
    var veces = timesRedeemed(r.id);
    var wrap = el("div", { style: "border:1px solid #4a3645;border-radius:12px;margin-bottom:7px;background:#211a23" });
    var head = el("button", {
      type: "button",
      style: "all:unset;box-sizing:border-box;display:flex;align-items:center;gap:9px;width:100%;padding:10px;cursor:pointer",
      onclick: function () { openId = openId === r.id ? null : r.id; renderList(); }
    }, [
      el("span", { style: "font-size:22px;width:30px;text-align:center", text: r.textoBoton || "🎁" }),
      el("span", { style: "flex:1;min-width:0;display:flex;flex-direction:column;gap:2px" }, [
        el("b", { style: "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13.5px", text: h.nombre || "Sin nombre (#" + r.id + ")" }),
        el("span", { style: "font-size:11.5px;opacity:.75", text:
          (r.tipo === "Regalo" ? "🎁 Regalo" : "✨ Experiencia") + " · " + (lv.emoji || "") + " " + (lv.nombre || "") + " · " + lv.coste + " pts"
          + (r.repetible ? " · 🔁" : "") + (veces ? " · ✓ canjeado" + (veces > 1 ? " ×" + veces : "") : "") })
      ]),
      el("span", { style: "opacity:.6", text: openId === r.id ? "▴" : "▾" })
    ]);
    wrap.appendChild(head);
    if (openId === r.id) wrap.appendChild(form(r));
    return wrap;
  }

  function field(label, input, hint) {
    return el("label", { style: "display:block;margin-bottom:8px" }, [
      el("div", { style: "font-size:11px;font-weight:800;color:#b094a0;margin-bottom:3px", text: label }),
      input,
      hint ? el("div", { style: "font-size:11px;opacity:.6;margin-top:2px", text: hint }) : null
    ]);
  }

  function form(r) {
    var f = el("div", { style: "padding:0 10px 10px;border-top:1px solid #3c2e39" });
    var h = splitHist(r.mensajeHistorico);

    var emoji = el("input", { maxlength: "8", style: INP + "text-align:center;font-size:20px" });
    emoji.value = r.textoBoton;
    emoji.addEventListener("input", function () { r.textoBoton = emoji.value.trim(); markDirty(); });

    var tipo = el("select", { style: INP });
    TIPOS.forEach(function (t) { tipo.appendChild(el("option", { value: t, text: t })); });
    tipo.value = r.tipo;
    tipo.addEventListener("change", function () { r.tipo = tipo.value; markDirty(); });

    var nivel = el("select", { style: INP });
    levels.forEach(function (lv) { nivel.appendChild(el("option", { value: lv.id, text: (lv.emoji || "") + " " + lv.nombre + " · " + lv.coste + " pts" })); });
    nivel.value = r.nivel;
    nivel.addEventListener("change", function () { r.nivel = nivel.value; markDirty(); });

    var nombre = el("input", { placeholder: "Cena en Pai Pai", style: INP });
    nombre.value = h.nombre;
    var detalle = el("input", { placeholder: "experiencia gastronómica disfrutada 🍽️", style: INP });
    detalle.value = h.detalle;
    function syncHist() {
      var n = nombre.value.trim(), d = detalle.value.trim();
      r.mensajeHistorico = d ? n + " — " + d : n;
      markDirty();
    }
    nombre.addEventListener("input", syncHist);
    detalle.addEventListener("input", syncHist);

    var popup = el("textarea", { placeholder: "¡Planazo desbloqueado! …", style: INP + "min-height:84px;font-weight:500" });
    popup.value = r.mensajePopup;
    popup.addEventListener("input", function () { r.mensajePopup = popup.value; markDirty(); });

    var rep = el("input", { type: "checkbox" });
    rep.checked = !!r.repetible;
    rep.addEventListener("change", function () { r.repetible = rep.checked; markDirty(); });

    var estado = el("select", { style: INP });
    ESTADOS.forEach(function (e) { estado.appendChild(el("option", { value: e.id, text: e.label + " — " + e.hint })); });
    estado.value = estadoDe(r);
    estado.addEventListener("change", function () {
      setEstado(r, estado.value); markDirty();
      tab = estado.value; render(); // se mueve a su pestaña
    });

    f.appendChild(el("div", { style: "display:grid;grid-template-columns:64px minmax(0,1fr);gap:6px;margin-top:10px" }, [
      field("Emoji", emoji), field("Tipo", tipo)
    ]));
    f.appendChild(field("Nivel (precio)", nivel));
    f.appendChild(field("Nombre (se revela al canjear)", nombre));
    f.appendChild(field("Texto para Recuerdos", detalle, "Sale bajo el nombre en Recuerdos."));
    f.appendChild(field("Mensaje al canjear", popup));
    f.appendChild(el("label", { style: "display:flex;align-items:center;gap:8px;margin:2px 0 10px;cursor:pointer" }, [
      rep, el("span", { text: "🔁 Repetible: se puede canjear varias veces (no desaparece al canjearlo)" })
    ]));
    f.appendChild(field("Estado", estado));
    var veces = timesRedeemed(r.id);
    if (veces) f.appendChild(el("div", { style: "font-size:11.5px;opacity:.7", text:
      "✓ Ya canjeado " + (veces > 1 ? veces + " veces" : "una vez") + ". Editarlo no cambia sus recuerdos." + (r.repetible ? "" : " Como no es repetible, ya no sale en Premios.") }));
    return f;
  }

  /* ---------- acciones ---------- */
  function addNew() {
    var max = items.reduce(function (m, r) { return Math.max(m, r.id); }, 0);
    var r = { id: max + 1, tipo: "Experiencia", textoBoton: "🎁", nivel: levels[0] && levels[0].id,
              disponible: true, retirado: false, repetible: false, mensajePopup: "", mensajeHistorico: "" };
    items.push(r);
    tab = "disponible"; openId = r.id; markDirty(); render();
    setTimeout(function () { var i = root && root.querySelector("#pgList input"); if (i) { i.focus(); i.select(); } }, 30);
  }

  function problems() {
    var out = [];
    levels.forEach(function (lv) {
      if (!lv.nombre) out.push("Un nivel no tiene nombre.");
      if (!(lv.coste > 0)) out.push("El nivel «" + (lv.nombre || "?") + "» necesita un precio mayor que 0.");
    });
    items.forEach(function (r) {
      if (estadoDe(r) !== "disponible") return;
      var n = splitHist(r.mensajeHistorico).nombre;
      var who = n || ("#" + r.id);
      if (!r.textoBoton) out.push("«" + who + "»: falta el emoji.");
      if (!n) out.push("#" + r.id + ": falta el nombre.");
      if (!r.mensajePopup.trim()) out.push("«" + who + "»: falta el mensaje al canjear.");
    });
    return out;
  }

  function catalogOut() {
    return items.map(function (r) {
      var lv = levelById(r.nivel);
      var o = { id: r.id, tipo: r.tipo, textoBoton: r.textoBoton, nivel: lv.id, coste: lv.coste,
                disponible: estadoDe(r) === "disponible", mensajePopup: r.mensajePopup, mensajeHistorico: r.mensajeHistorico };
      if (r.repetible) o.repetible = true;
      if (r.retirado) o.retirado = true;
      return o;
    });
  }
  function levelsOut() {
    return levels.map(function (lv) { return { id: lv.id, nombre: lv.nombre, coste: Math.round(Number(lv.coste)) || 0, emoji: lv.emoji || "" }; });
  }

  function save() {
    var p = problems();
    if (p.length) { window.alert("Antes de guardar:\n\n• " + p.slice(0, 8).join("\n• ") + (p.length > 8 ? "\n…" : "")); return; }
    if (!window.PiviContent) { window.alert("No se puede guardar: falta PiviContent."); return; }
    var hasCloud = !!PiviContent.hasCloud;
    if (hasCloud && !window.confirm("Vas a cambiar los premios REALES en los dos móviles.\n\n¿Guardar?")) return;
    var btn = document.getElementById("pgSave");
    if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }
    PiviContent.save({ recompensas: catalogOut(), niveles: levelsOut(), recompensasOverride: {} })
      .then(function () { dirty = false; toast("🎁 Premios guardados y sincronizados"); close(true); })
      .catch(function (err) {
        if (!hasCloud) { dirty = false; toast("🎁 Aplicado solo en esta sesión (sin nube)", 2800); close(true); return; }
        window.alert("No se ha podido guardar en la nube: " + err.message + "\n\nNo se ha perdido nada: sigue abierto para que lo intentes otra vez.");
        if (btn) { btn.disabled = false; btn.textContent = "💾 Guardar"; }
      });
  }

  function download() {
    var data = { tipo: "pivi-premios", version: 1, fecha: new Date().toISOString(), niveles: levelsOut(), recompensas: catalogOut() };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var d = new Date(), day = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    var a = el("a", { href: URL.createObjectURL(blob), download: "pivi-premios-" + day + ".json" });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast("⬇️ Copia descargada");
  }
  function restore() {
    var inp = el("input", { type: "file", accept: "application/json,.json", style: "display:none" });
    inp.addEventListener("change", function () {
      var file = inp.files && inp.files[0];
      if (!file) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var d = JSON.parse(rd.result);
          var list = Array.isArray(d) ? d : d.recompensas;
          if (!Array.isArray(list) || !list.length || !list.every(function (r) { return r && r.id != null; })) throw new Error("no parece una copia de premios");
          if (!window.confirm("¿Cargar esta copia (" + list.length + " premios)? Sustituye lo que hay en el gestor; no se guarda hasta que pulses «Guardar».")) return;
          if (Array.isArray(d.niveles) && d.niveles.length) levels = clone(d.niveles);
          items = normalize(list);
          tab = "disponible"; openId = null; markDirty(); render();
        } catch (e) { window.alert("No se ha podido leer la copia: " + e.message); }
      };
      rd.readAsText(file);
    });
    document.body.appendChild(inp); inp.click(); setTimeout(function () { inp.remove(); }, 60000);
  }

  function close(force) {
    if (!force && dirty && !window.confirm("Hay cambios sin guardar. ¿Cerrar y perderlos?")) return;
    if (root) root.remove();
    root = null;
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) { if (e.key === "Escape") close(false); }

  function open() {
    if (root) return;
    root = el("div", { id: "piviGestor", style: "position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:12px" });
    var hasCloud = !!(window.PiviContent && PiviContent.hasCloud);
    var panel = el("div", { style: "background:#1c1622;color:#ffe9e2;border:1px solid #4a3645;border-radius:16px;width:min(640px,100%);height:min(92vh,900px);display:flex;flex-direction:column;font:600 13px/1.4 system-ui,sans-serif;overflow:hidden" }, [
      el("div", { style: "display:flex;align-items:center;gap:8px;padding:14px 14px 8px" }, [
        el("b", { style: "font-size:15px", text: "🎁 Gestor de premios" }),
        el("span", { style: "flex:1" }),
        el("button", { type: "button", style: btnCss("#ff7d8c", "#2a1016"), onclick: function () { close(false); } }, ["Cerrar"])
      ]),
      el("div", { style: "margin:0 14px 8px;padding:8px 10px;border-radius:10px;font-weight:700;" + (hasCloud ? "background:#3a1f25;color:#ffc8dd" : "background:#251d24;color:#caffbf"),
        text: hasCloud ? "⚠️ Esto NO es el sandbox: al guardar cambian los premios REALES de los dos móviles. Lo ya canjeado no cambia (Recuerdos guarda su foto)."
                       : "Sin nube en este navegador: los cambios solo se aplican en esta sesión." }),
      el("div", { id: "pgBody", style: "flex:1;overflow:auto;padding:4px 14px 14px" }, [el("div", { style: "opacity:.7", text: "Cargando premios…" })]),
      el("div", { style: "padding:8px 14px 12px;border-top:1px solid #3c2e39;background:#191320" }, [
        el("div", { id: "pgDirty", style: "min-height:16px;margin-bottom:6px;font-size:11.5px;color:#ffd166;text-align:center" }),
        el("div", { style: "display:grid;grid-template-columns:1fr 1fr 1.4fr;gap:6px" }, [
          el("button", { type: "button", style: btnCss() + "padding:10px 4px", onclick: download, title: "Descargar una copia del catálogo" }, ["⬇️ Copia"]),
          el("button", { type: "button", style: btnCss() + "padding:10px 4px", onclick: restore, title: "Cargar una copia descargada antes" }, ["⬆️ Restaurar"]),
          el("button", { id: "pgSave", type: "button", style: btnCss("#8ac926", "#0f2a0a") + "padding:10px 4px", onclick: save }, ["💾 Guardar"])
        ])
      ])
    ]);
    root.appendChild(panel);
    root.addEventListener("click", function (e) { if (e.target === root) close(false); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(root);
    dirty = false; tab = "disponible"; openId = null;
    loadData().then(render).catch(function (e) {
      var b = document.getElementById("pgBody");
      if (b) b.textContent = "No se han podido cargar los premios: " + e.message;
    });
  }

  window.PiviGestor = { open: open, close: close };
})();
