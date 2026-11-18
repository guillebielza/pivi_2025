/* ============================================================
   pivi-avisos.js — 🔔 Avisos en el móvil (notificaciones push)
   ------------------------------------------------------------
   - Botón 🔔 en la cabecera de Inicio → panel para activar los
     avisos en ESTE dispositivo y elegir cuáles quiere.
   - Activar = suscripción push del navegador (con la clave pública
     que da la función pivi-push) + una fila en la tabla pivi_push con
     el id de este dispositivo (así no te avisa de lo que haces tú).
   - Quien decide y envía es la función de Supabase
     (supabase/functions/pivi-push); sw.js enseña el aviso y abre
     Pivi al tocarlo.
   - En iPhone solo funciona con Pivi instalada en la pantalla de
     inicio (iOS 16.4 o más).
   - En modo Dev, el panel deja además mandar una nota a la pareja.
   - OJO: se carga ANTES de pivi-dev.js para quedarse con la config de
     la nube (el modo Dev pone window.PIVI_CLOUD = null).
   ============================================================ */
(function () {
  "use strict";

  var CLOUD = window.PIVI_CLOUD;
  if (!CLOUD || !CLOUD.url || !CLOUD.anonKey || !CLOUD.profileId) return;

  var ROOT = CLOUD.url.replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
  var FN = ROOT + "/functions/v1/pivi-push";
  var K_CLAVE = "pivi_push_clave";   // clave pública VAPID (copia local)
  var K_PREFS = "pivi_push_prefs";   // qué avisos quiere este dispositivo
  var K_SYNC = "pivi_push_sync";     // última vez que se guardó la suscripción
  var K_EP = "pivi_push_ep";         // endpoint guardado
  var HORA = 3600 * 1000;

  var TIPOS = [
    { id: "ruleta", ic: "🎡", nombre: "Ruleta", txt: "Lunes y miércoles, si aún no se ha tirado" },
    { id: "finde", ic: "🎮", nombre: "Retos del finde", txt: "El sábado al abrirse y el domingo si quedan" },
    { id: "pareja", ic: "💞", nombre: "Lo que hace tu pareja", txt: "Puntos, partidas y canjes" },
    { id: "premios", ic: "🎯", nombre: "Premios", txt: "Al llegar a un nivel y cuando hay premios nuevos" },
    { id: "notas", ic: "💌", nombre: "Notas", txt: "Mensajes que te mandan desde Pivi" }
  ];

  /* ---------- utilidades ---------- */
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function rem(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function enc(v) { return encodeURIComponent(v); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function toast(t, ms) { if (window.PiviCore && PiviCore.toast) PiviCore.toast(t, ms || 2400); }
  function device() {
    return (window.PiviLedger && PiviLedger.deviceId) ? PiviLedger.deviceId() : (get("pivi_device") || "d-desconocido");
  }
  function u8(b64) {
    var s = String(b64).replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function conTiempo(p, ms, msg) {
    return Promise.race([p, new Promise(function (_, ko) { setTimeout(function () { ko(new Error(msg)); }, ms); })]);
  }

  function rest(ruta, metodo, cuerpo, prefer) {
    var h = { "apikey": CLOUD.anonKey, "Content-Type": "application/json", "x-pivi-profile": CLOUD.profileId };
    if (/^eyJ/.test(CLOUD.anonKey)) h.Authorization = "Bearer " + CLOUD.anonKey;
    if (prefer) h.Prefer = prefer;
    return fetch(ROOT + "/rest/v1/" + ruta, {
      method: metodo || "GET", headers: h, cache: "no-store",
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
    }).then(function (r) {
      return r.text().then(function (t) {
        if (!r.ok) throw new Error("HTTP " + r.status + " " + t.slice(0, 140));
        return t ? JSON.parse(t) : null;
      });
    });
  }

  /* ---------- capacidades del dispositivo ---------- */
  function soportado() {
    return !!(window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
  }
  function esIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }
  function instalada() {
    return (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  }
  function permiso() { return soportado() ? Notification.permission : "no"; }

  function swReg() {
    return conTiempo(navigator.serviceWorker.ready, 8000, "La app aún no está lista (service worker). Recarga la página.");
  }
  function subActual() {
    if (!soportado()) return Promise.resolve(null);
    return swReg().then(function (r) { return r.pushManager.getSubscription(); });
  }

  function clavePublica() {
    return fetch(FN, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { if (!j || !j.clave) throw new Error("sin clave"); set(K_CLAVE, j.clave); return j.clave; });
  }
  function mismaClave(sub, clave) {
    var k = sub && sub.options && sub.options.applicationServerKey;
    if (!k || !clave) return true; // no se puede saber: se da por buena
    var a = new Uint8Array(k), b = u8(clave);
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function prefs() {
    var p = {};
    try { p = JSON.parse(get(K_PREFS)) || {}; } catch (e) {}
    TIPOS.forEach(function (t) { if (typeof p[t.id] !== "boolean") p[t.id] = true; });
    return p;
  }

  /* ---------- guardar / activar / desactivar ---------- */
  function guardar(sub) {
    var j = sub.toJSON();
    var fila = {
      endpoint: j.endpoint, profile_id: CLOUD.profileId, device_id: device(),
      sub: { endpoint: j.endpoint, keys: j.keys }, prefs: prefs(),
      ua: String(navigator.userAgent || "").slice(0, 200), updated_at: new Date().toISOString()
    };
    return rest("pivi_push", "POST", [fila], "resolution=merge-duplicates,return=minimal")
      .then(function () {
        // fuera las suscripciones viejas de este mismo dispositivo
        return rest("pivi_push?device_id=eq." + enc(fila.device_id) + "&endpoint=neq." + enc(fila.endpoint), "DELETE", undefined, "return=minimal")
          .catch(function () {});
      })
      .then(function () { set(K_SYNC, String(Date.now())); set(K_EP, fila.endpoint); });
  }

  // reg y clave se preparan al abrir el panel: en iPhone la suscripción
  // tiene que pedirse en el mismo toque, sin esperas de red por medio.
  var listo = { reg: null, clave: get(K_CLAVE) };
  function preparar() {
    if (!soportado()) return Promise.resolve();
    return Promise.all([
      swReg().then(function (r) { listo.reg = r; }),
      clavePublica().then(function (k) { listo.clave = k; }).catch(function (e) { if (!listo.clave) throw e; })
    ]);
  }

  function activar() {
    if (!listo.reg || !listo.clave) return Promise.reject(new Error("Aún cargando, prueba otra vez en un momento."));
    var reg = listo.reg, opciones = { userVisibleOnly: true, applicationServerKey: u8(listo.clave) };
    // subscribe() va lo PRIMERO, dentro del mismo toque (iPhone lo exige),
    // y ya pide el permiso del sistema si hace falta. Si había una
    // suscripción con otra clave, se quita y se repite.
    return reg.pushManager.subscribe(opciones)
      .catch(function (e) {
        if (Notification.permission !== "granted") throw e;
        return reg.pushManager.getSubscription().then(function (s) {
          if (!s) throw e;
          return s.unsubscribe().then(function () { return reg.pushManager.subscribe(opciones); });
        });
      })
      .then(guardar);
  }

  function desactivar() {
    return subActual().then(function (s) {
      var ep = (s && s.endpoint) || get(K_EP);
      return (s ? s.unsubscribe() : Promise.resolve()).then(function () {
        if (ep) return rest("pivi_push?endpoint=eq." + enc(ep), "DELETE", undefined, "return=minimal");
      });
    }).then(function () { rem(K_SYNC); rem(K_EP); });
  }

  function guardarPrefs(p) {
    set(K_PREFS, JSON.stringify(p));
    return subActual().then(function (s) {
      if (!s) return;
      return rest("pivi_push?endpoint=eq." + enc(s.endpoint), "PATCH",
        { prefs: p, updated_at: new Date().toISOString() }, "return=minimal");
    });
  }

  function nota(texto, titulo, paraMi) {
    var me = device();
    return rest("pivi_notas", "POST", [{
      profile_id: CLOUD.profileId, from_device: me, to_device: paraMi ? me : null,
      titulo: titulo || null, texto: texto
    }], "return=minimal");
  }

  // Al abrir Pivi: si este móvil ya tiene avisos, refresca su fila de vez
  // en cuando (por si el navegador cambió la suscripción o se borró).
  function refrescar() {
    if (permiso() !== "granted") return;
    subActual().then(function (s) {
      if (!s) return;
      var viejo = Date.now() - (Number(get(K_SYNC)) || 0) > 20 * HORA;
      if (viejo || get(K_EP) !== s.endpoint) return guardar(s);
    }).catch(function () {});
  }

  /* ============================================================
     Interfaz: botón 🔔 + panel
     ============================================================ */
  var CSS =
    ".avisos-btn{position:relative}" +
    ".avisos-dot{position:absolute;top:5px;right:6px;width:10px;height:10px;border-radius:50%;background:var(--primary);box-shadow:0 0 0 2px var(--surface)}" +
    ".avisos-modal{position:relative;text-align:left;max-width:440px}" +
    ".avisos-modal h3{margin:0 44px 4px 0;font-family:var(--font-head);font-size:1.3rem;color:var(--text)}" +
    ".avisos-modal .av-sub{margin:0 0 12px;color:var(--text-soft);line-height:1.45}" +
    ".avisos-estado{display:flex;gap:10px;align-items:flex-start;padding:11px 13px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border);color:var(--text-soft);line-height:1.45;margin:4px 0 10px}" +
    ".avisos-estado.ok{background:var(--success-bg);border-color:transparent;color:var(--text)}" +
    ".avisos-estado.warn{background:var(--warn-bg);border-color:transparent;color:var(--text)}" +
    ".avisos-list{list-style:none;margin:8px 0 4px;padding:0;display:flex;flex-direction:column;gap:7px}" +
    ".aviso-row{display:flex;align-items:center;gap:11px;padding:9px 12px;border:1px solid var(--border);border-radius:14px;background:var(--surface);cursor:pointer}" +
    ".aviso-row .av-ic{font-size:1.25rem;width:1.6em;text-align:center;flex:none}" +
    ".aviso-row .av-tx{flex:1;min-width:0}" +
    ".aviso-row b{display:block;color:var(--text);font-weight:800}" +
    ".aviso-row small{display:block;color:var(--muted);font-size:.84rem;line-height:1.3}" +
    ".aviso-sw{appearance:none;-webkit-appearance:none;margin:0;width:46px;height:28px;border-radius:14px;background:var(--surface-inset);border:1px solid var(--border-strong);position:relative;flex:none;cursor:pointer;transition:background .2s}" +
    ".aviso-sw::after{content:'';position:absolute;top:2px;left:2px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .2s}" +
    ".aviso-sw:checked{background:var(--primary);border-color:var(--primary)}" +
    ".aviso-sw:checked::after{transform:translateX(18px)}" +
    ".aviso-sw:disabled{opacity:.5}" +
    ".aviso-sw:focus-visible{outline:none;box-shadow:var(--ring)}" +
    ".avisos-pie{margin:12px 0 0;font-size:.85rem;color:var(--muted);line-height:1.4}" +
    ".avisos-acc{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}" +
    ".avisos-acc .btn{flex:1 1 150px}" +
    ".avisos-dev{margin-top:16px;padding:12px;border:2px dashed var(--border-strong);border-radius:14px}" +
    ".avisos-dev textarea{width:100%;box-sizing:border-box;min-height:70px;margin:6px 0 8px;padding:9px 11px;border-radius:12px;border:1px solid var(--border-strong);background:var(--surface);color:var(--text);font:inherit;resize:vertical}";

  var btn = null, overlay = null, ocupado = false;

  function pintarBoton() {
    if (!btn) return;
    var dot = btn.querySelector(".avisos-dot");
    var invitar = (soportado() && permiso() === "default") || (esIOS() && !instalada() && !soportado());
    if (invitar && !dot) { dot = document.createElement("span"); dot.className = "avisos-dot"; btn.appendChild(dot); }
    if (!invitar && dot) dot.remove();
  }

  function crearBoton() {
    var head = document.querySelector(".app-header");
    if (!head || head.querySelector(".avisos-btn")) return;
    var st = document.createElement("style");
    st.textContent = CSS;
    document.head.appendChild(st);
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-toggle avisos-btn";
    btn.setAttribute("aria-label", "Avisos en el móvil");
    btn.title = "Avisos en el móvil";
    btn.textContent = "🔔";
    var tema = head.querySelector(".theme-toggle");
    head.insertBefore(btn, tema || null);
    btn.addEventListener("click", abrir);
    pintarBoton();
  }

  function cerrar() { if (overlay) { overlay.remove(); overlay = null; } }

  function abrir() {
    cerrar();
    overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = '<div class="modal avisos-modal" role="dialog" aria-modal="true" aria-labelledby="avisosTit">' +
      '<button type="button" class="modal-close" aria-label="Cerrar">✕</button>' +
      '<h3 id="avisosTit">🔔 Avisos en este móvil</h3>' +
      '<div id="avisosCuerpo"><p class="av-sub">Cargando…</p></div></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay || e.target.closest(".modal-close")) cerrar();
    });
    document.addEventListener("keydown", function alEsc(e) {
      if (e.key === "Escape") { cerrar(); document.removeEventListener("keydown", alEsc); }
    });
    pintar();
    preparar().then(pintar).catch(function () { pintar(); });
  }

  function lista(activa) {
    var p = prefs();
    return '<ul class="avisos-list">' + TIPOS.map(function (t) {
      return '<li><label class="aviso-row"><span class="av-ic" aria-hidden="true">' + t.ic + '</span>' +
        '<span class="av-tx"><b>' + t.nombre + '</b><small>' + t.txt + '</small></span>' +
        '<input type="checkbox" class="aviso-sw" data-tipo="' + t.id + '"' + (p[t.id] ? " checked" : "") +
        (activa ? "" : " disabled") + ' aria-label="' + esc(t.nombre) + '"></label></li>';
    }).join("") + '</ul>';
  }

  function bloqueDev() {
    if (!window.PIVI_DEV) return "";
    return '<div class="avisos-dev"><b>🛠 Modo Dev · 💌 Nota para tu pareja</b>' +
      '<div class="muted" style="font-size:.85rem">De verdad: le llega a los otros móviles con avisos (a este no).</div>' +
      '<textarea id="avNota" maxlength="300" placeholder="Escribe la nota…"></textarea>' +
      '<button type="button" class="btn primary" data-av="nota">Enviar nota</button></div>';
  }

  function pintar() {
    var box = overlay && overlay.querySelector("#avisosCuerpo");
    if (!box) return;
    var pie = '<p class="avisos-pie">Cada móvil elige lo suyo. De 23:00 a 8:00 no suena nada: lo de la noche llega por la mañana.</p>';

    if (!soportado()) {
      var msg = esIOS() && !instalada()
        ? "📲 En iPhone, los avisos solo llegan con Pivi instalada. En Safari, toca <b>Compartir</b> y luego <b>«Añadir a pantalla de inicio»</b>. Después abre Pivi desde su icono y vuelve aquí."
        : "Este navegador no puede recibir avisos. Prueba con Chrome o Safari, o instala Pivi en el móvil.";
      box.innerHTML = '<div class="avisos-estado warn">' + msg + '</div>' + lista(false) + pie + bloqueDev();
      return;
    }
    if (permiso() === "denied") {
      box.innerHTML = '<div class="avisos-estado warn">🔕 Los avisos de Pivi están bloqueados. Actívalos en los ajustes del ' +
        (esIOS() ? "iPhone (Ajustes → Notificaciones → Pivi)" : "navegador (el candado junto a la dirección → Notificaciones)") +
        ' y vuelve aquí.</div>' + lista(false) + pie + bloqueDev();
      return;
    }
    subActual().then(function (s) {
      if (!overlay) return;
      // con otra clave (no debería pasar) cuenta como no activada: «Activar» la rehace
      var activa = !!s && permiso() === "granted" && mismaClave(s, listo.clave);
      if (activa) {
        box.innerHTML = '<div class="avisos-estado ok">✅ Activados en este móvil. Elige cuáles quieres:</div>' + lista(true) +
          '<div class="avisos-acc">' +
          '<button type="button" class="btn secondary" data-av="prueba">📨 Enviar aviso de prueba</button>' +
          '<button type="button" class="btn ghost" data-av="off">Desactivar aquí</button></div>' + pie + bloqueDev();
      } else {
        var preparado = !!(listo.reg && listo.clave);
        box.innerHTML = '<p class="av-sub">Que Pivi te avise aunque no la tengas abierta:</p>' + lista(false) +
          '<div class="avisos-acc"><button type="button" class="btn primary big" data-av="on"' + (preparado ? "" : " disabled") + '>' +
          (preparado ? "🔔 Activar avisos en este móvil" : "Preparando…") + '</button></div>' + pie + bloqueDev();
      }
      enlazar(box);
    }).catch(function (e) {
      box.innerHTML = '<div class="avisos-estado warn">No se ha podido comprobar: ' + esc(e.message) + '</div>' + bloqueDev();
      enlazar(box);
    });
  }

  function enlazar(box) {
    box.querySelectorAll("[data-av]").forEach(function (b) { b.addEventListener("click", accion); });
    box.querySelectorAll(".aviso-sw").forEach(function (c) {
      c.addEventListener("change", function () {
        var p = prefs();
        p[c.getAttribute("data-tipo")] = c.checked;
        guardarPrefs(p).catch(function (e) { toast("⚠️ No se ha guardado: " + e.message, 3200); });
      });
    });
  }

  function accion(e) {
    var b = e.currentTarget, que = b.getAttribute("data-av");
    if (ocupado) return;
    var fin = function () { ocupado = false; b.disabled = false; pintarBoton(); pintar(); };
    ocupado = true; b.disabled = true;
    if (que === "on") {
      activar().then(function () { toast("🔔 ¡Avisos activados!", 2400); })
        .catch(function (err) {
          if (permiso() === "denied") toast("🔕 Has bloqueado los avisos", 2600);
          else toast("⚠️ No se han podido activar: " + err.message, 3600);
        }).then(fin);
    } else if (que === "off") {
      desactivar().then(function () { toast("🔕 Avisos desactivados en este móvil", 2400); })
        .catch(function (err) { toast("⚠️ " + err.message, 3200); }).then(fin);
    } else if (que === "prueba") {
      nota("¡Así te llegarán los avisos de Pivi! 💞", "Aviso de prueba", true)
        .then(function () { toast("📨 Enviado: debería llegarte en unos segundos", 3000); })
        .catch(function (err) { toast("⚠️ " + err.message, 3200); }).then(fin);
    } else if (que === "nota") {
      var ta = overlay && overlay.querySelector("#avNota");
      var txt = ta ? ta.value.trim() : "";
      if (!txt) { ocupado = false; b.disabled = false; if (ta) ta.focus(); return; }
      if (!window.confirm("¿Enviar esta nota de verdad a tu pareja?\n\n" + txt)) { ocupado = false; b.disabled = false; return; }
      nota(txt.slice(0, 300), null, false)
        .then(function () { toast("💌 Nota enviada", 2400); if (ta) ta.value = ""; })
        .catch(function (err) { toast("⚠️ " + err.message, 3200); })
        .then(function () { ocupado = false; b.disabled = false; });
    }
  }

  function iniciar() {
    crearBoton();
    refrescar();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();

  window.PiviAvisos = { abrir: abrir, soportado: soportado, refrescar: refrescar };
})();
