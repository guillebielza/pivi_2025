/* ============================================================
   pivi-dev.js — Modo desarrollador (SOLO para el dueño)
   ------------------------------------------------------------
   - Activación secreta: 5 toques en «Pivi» (cabecera de la portada) + PIN.
   - AISLAMIENTO: mientras Dev está ON, todos los datos del juego
     se guardan en un "sandbox" (prefijo pividev::) y la
     SINCRONIZACIÓN se pausa. Tus puntos/canjeos reales no se tocan.
     Al salir de Dev y recargar, vuelves a tus datos reales.
   - Capacidades: saltar reglas (ruleta/retos), editar puntos y
     candados, forzar recompensas y celebración, viajar en el tiempo
     y simular un evento de tu pareja.

   Carga este script DESPUÉS de cloud-config.js y ANTES de
   pivi-ledger.js / cloud-sync.js.
   ============================================================ */
(function () {
  "use strict";

  /* ====== CONFIG: cambia tu PIN aquí ====== */
  var DEV_PIN = "2026";          // <-- tu PIN secreto (cámbialo)
  var TAPS_NEEDED = 5;           // toques en «Pivi» para pedir PIN
  var TAP_WINDOW_MS = 1500;      // ventana de tiempo entre toques

  /* ====== claves ====== */
  var FLAG = "pivi_dev_on";          // local, NO se sincroniza
  var DATE_KEY = "pivi_dev_date";    // fecha simulada (ISO) o vacío
  var BYPASS_KEY = "pivi_dev_bypass";// "1" = saltar reglas
  var FORCE_KEY = "pivi_dev_force";  // "1" = todas las recompensas disponibles
  var SBX = "pividev::";             // prefijo del sandbox

  var SNAP_KEY = "pivi_dev_realsnap"; // copia de tus datos REALES al entrar (se restaura al salir)

  function isGameKey(k) {
    if (!k || k.indexOf(SBX) === 0) return false;
    var exact = ["points", "redeemedRewards", "revokedRewards", "usedCodes", "activityLog", "pivi_streak",
                 "pivi_pending_ev", "pivi_feed_seen", "pivi_fixes", "pivi_updated_at", "pivi_canjes", "pivi_meses"];
    if (exact.indexOf(k) !== -1) return true;
    var pref = ["wheel_spin_", "weekend_played_", "weekend_rewarded_", "quiz_daily_", "wordle_daily_", "wordle_"];
    for (var i = 0; i < pref.length; i++) if (k.indexOf(pref[i]) === 0) return true;
    return false;
  }

  /* ---------- accesos NATIVOS al almacenamiento ----------
     OJO: hay que parchear Storage.prototype, NO localStorage.setItem.
     Safari (iPhone) y Firefox no dejan cambiar el método en el propio
     localStorage: guardan la función como un dato y siguen escribiendo
     en las claves REALES. Por eso el sandbox no aislaba en el iPhone
     (el 17-nov-2026 un canje de prueba llegó a los datos reales). */
  var SP = Storage.prototype;
  var N = { get: SP.getItem, set: SP.setItem, rem: SP.removeItem, clear: SP.clear };
  function _get(k) { return N.get.call(localStorage, k); }
  function _set(k, v) { return N.set.call(localStorage, k, v); }
  function _rem(k) { return N.rem.call(localStorage, k); }
  function realKeys() {
    var out = [];
    for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (isGameKey(k)) out.push(k); }
    return out;
  }

  var DEV = false;
  try { DEV = _get(FLAG) === "1"; } catch (e) {}
  var SANDBOX_FAILED = false;

  /* ---------- reloj (viaje en el tiempo) ---------- */
  window.PiviClock = {
    now: function () {
      if (window.PIVI_DEV) {
        var f = _get(DATE_KEY);
        if (f) { var d = new Date(f); if (!isNaN(d.getTime())) return d; }
      }
      return new Date();
    }
  };

  if (DEV) {
    /* 1) SANDBOX: redirige las claves del juego a pividev:: (solo en localStorage) */
    var mapKey = function (store, k) { return (store === window.localStorage && isGameKey(k)) ? SBX + k : k; };
    var ok = false;
    try {
      SP.getItem = function (k) { return N.get.call(this, mapKey(this, k)); };
      SP.setItem = function (k, v) { return N.set.call(this, mapKey(this, k), v); };
      SP.removeItem = function (k) { return N.rem.call(this, mapKey(this, k)); };
      SP.clear = function () { // en Dev, "borrar todo" solo borra el sandbox
        if (this !== window.localStorage) return N.clear.call(this);
        var ks = [];
        for (var i = 0; i < this.length; i++) { var k = this.key(i); if (k && k.indexOf(SBX) === 0) ks.push(k); }
        ks.forEach(function (k) { _rem(k); });
      };

    /* 2) COMPROBACIÓN: ¿de verdad va al sandbox? Si no, NO hay modo Dev
          (más vale quedarse sin pruebas que tocar los datos reales). */
      var PK = "weekend_played___sandbox_probe";
      localStorage.setItem(PK, "1");
      ok = _get(SBX + PK) === "1" && _get(PK) === null && localStorage.getItem(PK) === "1";
      _rem(SBX + PK); _rem(PK);
    } catch (e) { ok = false; }
    if (!ok) {
      try { SP.getItem = N.get; SP.setItem = N.set; SP.removeItem = N.rem; SP.clear = N.clear; } catch (e) {}
      try { _rem(FLAG); } catch (e) {}
      DEV = false;
      SANDBOX_FAILED = true;
    }
  }
  window.PIVI_DEV = DEV;

  if (DEV) {
    /* 3) PAUSAR sincronización (cloud-sync verá que no hay config) */
    window.PIVI_CLOUD = null;

    /* 3) flags de capacidades (vivos, leídos por app.js / points-policy) */
    window.PIVI_DEV_BYPASS = _get(BYPASS_KEY) === "1";
    window.PIVI_DEV_FORCE_AVAILABLE = _get(FORCE_KEY) === "1";

    /* 4) que se NOTE: si te olvidas de salir, lo que juegues aquí no cuenta */
    document.documentElement.classList.add("pivi-dev");
  }

  /* ============================================================
     Activación / desactivación
     ============================================================ */
  function enableDev() {
    try {
      var snap = {};
      realKeys().forEach(function (k) {
        snap[k] = _get(k);
        // siembra el sandbox con una copia de tus datos reales (solo lo que falte)
        if (_get(SBX + k) == null) _set(SBX + k, _get(k));
      });
      // copia de seguridad de lo REAL: al salir se deja exactamente así
      _set(SNAP_KEY, JSON.stringify({ ts: new Date().toISOString(), data: snap }));
    } catch (e) {}
    _set(FLAG, "1");
    location.reload();
  }
  // Al salir: tus datos reales vuelven a como estaban al entrar. En Dev la
  // sincronización está parada, así que lo real no debería haber cambiado;
  // si algo se coló (como pasaba en el iPhone), aquí se deshace.
  function restoreRealSnapshot() {
    var raw = _get(SNAP_KEY);
    if (!raw) return;
    try {
      var snap = JSON.parse(raw).data || {};
      realKeys().forEach(function (k) { if (!(k in snap)) _rem(k); });
      Object.keys(snap).forEach(function (k) { if (snap[k] == null) _rem(k); else _set(k, snap[k]); });
    } catch (e) {}
    _rem(SNAP_KEY);
  }
  function disableDev() {
    restoreRealSnapshot();
    _rem(FLAG);
    location.reload();
  }

  function devPin() { return (window.PIVI_CONFIG && PIVI_CONFIG.devPin) || DEV_PIN; }
  function promptPin() {
    var pin = window.prompt("🛠 Modo Dev — introduce el PIN:");
    if (pin == null) return;
    if (String(pin) === devPin()) enableDev();
    else window.alert("PIN incorrecto.");
  }

  /* gesto secreto: TAPS_NEEDED toques en «Pivi» (portada) */
  var taps = 0, tapTimer = null;
  function onLogoTap(e) {
    e.preventDefault(); e.stopPropagation();
    taps++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(function () { taps = 0; }, TAP_WINDOW_MS);
    if (taps >= TAPS_NEEDED) { taps = 0; if (window.PIVI_DEV) openMenuOrExit(); else promptPin(); }
  }
  function openMenuOrExit() {
    // si ya está en dev, los 5 toques hacen scroll al panel
    var p = document.getElementById("piviDevBar");
    if (p) p.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Sobre el nombre "Pivi" de la cabecera (ya no hay logo 🎁), y solo en la
  // portada: en el resto de páginas "Pivi" es el enlace a Inicio de siempre
  function attachGesture() {
    var logo = document.querySelector(".app-header .brand");
    if (!logo) return;
    var here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    if (here !== "index.html") return;
    logo.addEventListener("click", onLogoTap);
  }

  /* ============================================================
     Barra de herramientas (solo en DEV)
     ============================================================ */
  function refreshGame() {
    if (typeof window.renderRewards === "function") { try { window.renderRewards(); } catch (e) {} }
    if (typeof window.updateWheelUI === "function") { try { window.updateWheelUI(); } catch (e) {} }
    if (typeof window.updateWeekendUI === "function") { try { window.updateWeekendUI(); } catch (e) {} }
    if (window.PiviLedger) { try { PiviLedger.render(); PiviLedger.renderStreak(); } catch (e) {} }
  }

  function setPointsDev(v) {
    v = Math.max(0, Number(v) || 0);
    if (typeof window.setPoints === "function") window.setPoints(v);
    else { localStorage.setItem("points", String(v)); }
    if (window.PiviCore) PiviCore.setPointsUI(v);
    refreshGame();
  }
  function addPointsDev(d) {
    var cur = Number(localStorage.getItem("points")) || 0;
    setPointsDev(cur + d);
  }

  function resetLocks() {
    var toRemove = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && (k.indexOf(SBX + "wheel_spin_") === 0 || k.indexOf(SBX + "weekend_") === 0)) toRemove.push(k);
    }
    toRemove.forEach(function (k) { _rem(k); });
    location.reload();
  }
  function wipeSandbox() {
    if (!window.confirm("¿Borrar TODO el sandbox de pruebas? (no afecta a tus datos reales)")) return;
    var toRemove = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(SBX) === 0) toRemove.push(k);
    }
    toRemove.forEach(function (k) { _rem(k); });
    location.reload();
  }
  function reseedFromReal() {
    if (!window.confirm("¿Recopiar tus datos REALES al sandbox? (sobrescribe el sandbox)")) return;
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (isGameKey(k)) _set(SBX + k, _get(k));
    }
    location.reload();
  }

  function clearRedeemed() {
    localStorage.setItem("redeemedRewards", "[]");
    refreshGame();
  }
  function clearUsedCodes() {
    localStorage.setItem("usedCodes", "[]");
    refreshGame();
  }

  function setSimDay(weekday) {
    // weekday: 0=Dom..6=Sáb, o null para real.
    // Semana de lunes a domingo: "Dom" es el domingo que sigue al sábado
    // (antes saltaba al domingo ANTERIOR y sáb/dom caían en findes distintos).
    if (weekday == null) { _rem(DATE_KEY); location.reload(); return; }
    var d = new Date();
    var diff = ((weekday + 6) % 7) - ((d.getDay() + 6) % 7);
    d.setDate(d.getDate() + diff);
    _set(DATE_KEY, d.toISOString());
    location.reload();
  }

  function simulatePartner() {
    var amount = 6;
    if (window.PiviLedger) {
      // evento de "otro dispositivo": fuerza device distinto
      var log = PiviLedger.readLog();
      log.push({
        id: "sim-" + Date.now(), ts: new Date().toISOString(),
        type: "wheel", delta: amount, label: "Ruleta (pareja)", device: "pareja-sim", dev: true
      });
      localStorage.setItem("activityLog", JSON.stringify(log)); // sandbox
      addPointsDev(amount); // la pareja también suma (solo en el sandbox)
    }
    if (window.PiviCore) PiviCore.toast("💞 Tu pareja: Ruleta (pareja) (+" + amount + ")", 2600);
  }

  /* ---------- aviso visible en todas las páginas ---------- */
  function markDevUI() {
    if (!document.getElementById("piviDevStyle")) {
      var st = document.createElement("style");
      st.id = "piviDevStyle";
      st.textContent =
        "html.pivi-dev .points-chip{background:repeating-linear-gradient(45deg,#ffd166 0 9px,#f4a261 9px 18px);color:#2a1016}" +
        "#piviDevRibbon{position:absolute;left:0;right:0;top:100%;display:flex;align-items:center;justify-content:center;gap:8px;" +
        "padding:5px 10px;background:repeating-linear-gradient(45deg,#2a1f12 0 12px,#33261a 12px 24px);color:#ffd166;" +
        "font:800 12px/1.2 system-ui,sans-serif;letter-spacing:.2px;text-align:center;box-shadow:0 4px 10px rgba(0,0,0,.18)}" +
        "#piviDevRibbon span{color:#ffe9e2;font-weight:700}" +
        "#piviDevRibbon button{border:none;border-radius:999px;padding:4px 10px;background:#ffd166;color:#2a1016;font:800 11.5px system-ui;cursor:pointer}" +
        "html.pivi-dev .page{padding-top:calc(14px + 30px)}";
      document.head.appendChild(st);
    }
    // ⭐ -> 🛠 en el marcador: son puntos de PRUEBA
    document.querySelectorAll(".points-chip").forEach(function (chip) {
      chip.title = "Puntos de PRUEBA (modo Dev). Los reales no se tocan.";
      var t = chip.firstChild;
      if (t && t.nodeType === 3) t.nodeValue = t.nodeValue.replace("⭐", "🛠");
    });
    var header = document.querySelector(".app-header");
    if (header && !document.getElementById("piviDevRibbon")) {
      var r = document.createElement("div");
      r.id = "piviDevRibbon";
      r.setAttribute("role", "status");
      r.innerHTML = "🛠 MODO PRUEBAS <span>· nada de esto cuenta de verdad</span>";
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = "Salir";
      b.addEventListener("click", disableDev);
      r.appendChild(b);
      header.appendChild(r);
    }
  }

  function toggleBypass(on) {
    window.PIVI_DEV_BYPASS = on;
    _set(BYPASS_KEY, on ? "1" : "0");
    refreshGame();
  }
  function toggleForce(on) {
    window.PIVI_DEV_FORCE_AVAILABLE = on;
    _set(FORCE_KEY, on ? "1" : "0");
    refreshGame();
  }

  function buildBar() {
    if (document.getElementById("piviDevBar")) return;

    // Lanzador flotante: el panel arranca PLEGADO
    var fab = document.createElement("button");
    fab.id = "piviDevFab";
    fab.type = "button";
    fab.textContent = "🛠";
    fab.title = "Abrir panel Dev";
    fab.style.cssText = [
      "position:fixed", "left:max(12px, env(safe-area-inset-left, 0px))", "bottom:calc(12px + var(--bottom-ui, 0px))", "z-index:2000",
      "width:46px", "height:46px", "border-radius:50%", "border:1px solid #4a3645",
      "background:#1c1622", "color:#ffe9e2", "font-size:20px", "cursor:pointer",
      "box-shadow:0 10px 28px rgba(0,0,0,.45)", "display:grid", "place-items:center"
    ].join(";");
    document.body.appendChild(fab);

    var bar = document.createElement("div");
    bar.id = "piviDevBar";
    bar.innerHTML = ""; // se rellena abajo
    bar.style.cssText = [
      "position:fixed", "left:max(12px, env(safe-area-inset-left, 0px))", "bottom:calc(12px + var(--bottom-ui, 0px))", "z-index:2001",
      "width:280px", "max-width:calc(100vw - 24px)", "max-height:calc(100dvh - 120px)", "overflow:auto",
      "background:#1c1622", "color:#ffe9e2", "border:1px solid #4a3645",
      "border-radius:16px", "padding:14px", "box-shadow:0 14px 40px rgba(0,0,0,.5)",
      "font:600 12.5px/1.4 system-ui, sans-serif", "display:none"
    ].join(";");

    var simIso = _get(DATE_KEY);
    var simLabel = simIso ? new Date(simIso).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "short" }) : "Real (hoy)";

    bar.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
        '<b style="font-size:14px">🛠 PIVI DEV</b>' +
        '<span style="flex:1"></span>' +
        '<button data-act="min" title="Plegar" style="' + btnCss() + '">▾</button>' +
        '<button data-act="exit" style="' + btnCss("#ff7d8c", "#2a1016") + '">Salir</button>' +
      '</div>' +
      '<div style="margin:-2px 0 10px;padding:7px 9px;border-radius:9px;background:#251d24;color:#caffbf;font-weight:700">' +
        '🔒 Puntos reales: <b>' + (Number(_get("points")) || 0) + '</b> · no se tocan mientras estés aquí' +
      '</div>' +

      section("Puntos de prueba") +
      '<div style="display:flex;gap:6px;margin-bottom:8px">' +
        '<input id="devPts" type="number" placeholder="puntos" style="flex:1;min-width:0;padding:7px;border-radius:9px;border:1px solid #4a3645;background:#251d24;color:#fff">' +
        '<button data-act="setpts" style="' + btnCss("#ff8598", "#2a1016") + '">Fijar</button>' +
      '</div>' +
      '<div style="display:flex;gap:6px;margin-bottom:10px">' +
        '<button data-act="p10" style="' + btnCss() + '">+10</button>' +
        '<button data-act="m10" style="' + btnCss() + '">−10</button>' +
        '<button data-act="p100" style="' + btnCss() + '">+100</button>' +
      '</div>' +

      section("Reglas") +
      check("devBypass", "Saltar reglas (ruleta/retos libres)", window.PIVI_DEV_BYPASS) +
      check("devForce", "Todas las recompensas disponibles", window.PIVI_DEV_FORCE_AVAILABLE) +

      section("Día simulado: <span style='color:#ffb4a2'>" + simLabel + "</span>") +
      '<div id="devDays" style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px">' +
        dayBtn("Lun", 1) + dayBtn("Mar", 2) + dayBtn("Mié", 3) + dayBtn("Jue", 4) +
        dayBtn("Vie", 5) + dayBtn("Sáb", 6) + dayBtn("Dom", 0) +
        '<button data-day="real" style="' + btnCss("#caffbf", "#103018") + '">Real</button>' +
      '</div>' +

      section("Recompensas / efectos") +
      '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">' +
        '<button data-act="clearRedeemed" style="' + btnCss() + '">Vaciar canjeadas</button>' +
        '<button data-act="celebrate" style="' + btnCss("#ffd6a5", "#3a2a10") + '">🎉 Celebrar</button>' +
        '<button data-act="partner" style="' + btnCss("#ffc8dd", "#3a1f25") + '">💞 Simular pareja</button>' +
      '</div>' +

      section("Contenido REAL (afecta a los dos)") +
      '<div style="display:flex;gap:6px;margin-bottom:10px">' +
        '<button data-act="content" style="' + btnCss("#a0c4ff", "#0d1b33") + ';flex:1">📦 Editar códigos / ruleta / recompensas</button>' +
      '</div>' +

      section("Sandbox") +
      '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
        '<button data-act="resetLocks" style="' + btnCss() + '">Reset candados</button>' +
        '<button data-act="reseed" style="' + btnCss() + '">Recopiar real</button>' +
        '<button data-act="clearCodes" style="' + btnCss() + '">Reusar códigos</button>' +
        '<button data-act="wipe" style="' + btnCss("#ff7d8c", "#2a1016") + '">Limpiar todo</button>' +
      '</div>' +
      '<div style="margin-top:10px;opacity:.7;font-weight:600">Sandbox aislado · sync en pausa · tus puntos, canjes y retos reales están a salvo. Solo «📦 Contenido» escribe en la nube real.</div>';

    document.body.appendChild(bar);

    // listeners
    bar.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act],[data-day]");
      if (!b) return;
      if (b.hasAttribute("data-day")) {
        var dv = b.getAttribute("data-day");
        setSimDay(dv === "real" ? null : Number(dv));
        return;
      }
      var act = b.getAttribute("data-act");
      if (act === "min") setOpen(false);
      else if (act === "content") openContentEditor();
      else if (act === "exit") disableDev();
      else if (act === "setpts") setPointsDev(document.getElementById("devPts").value);
      else if (act === "p10") addPointsDev(10);
      else if (act === "m10") addPointsDev(-10);
      else if (act === "p100") addPointsDev(100);
      else if (act === "clearRedeemed") clearRedeemed();
      else if (act === "clearCodes") clearUsedCodes();
      else if (act === "celebrate") { if (window.PiviCore) PiviCore.celebrateReward("🎁"); }
      else if (act === "partner") simulatePartner();
      else if (act === "resetLocks") resetLocks();
      else if (act === "reseed") reseedFromReal();
      else if (act === "wipe") wipeSandbox();
    });
    bar.addEventListener("change", function (e) {
      if (e.target.id === "devBypass") toggleBypass(e.target.checked);
      else if (e.target.id === "devForce") toggleForce(e.target.checked);
    });

    // plegar / desplegar (recuerda el estado; arranca plegado)
    function setOpen(o) {
      bar.style.display = o ? "block" : "none";
      fab.style.display = o ? "none" : "grid";
      _set("pivi_dev_open", o ? "1" : "0");
    }
    fab.addEventListener("click", function () { setOpen(true); });
    setOpen(_get("pivi_dev_open") === "1");
  }

  function section(t) { return '<div style="margin:6px 0 7px;color:#b094a0;font-weight:800;text-transform:uppercase;font-size:10.5px;letter-spacing:.4px">' + t + '</div>'; }
  function btnCss(bg, fg) {
    return "border:none;border-radius:9px;padding:7px 10px;font:700 12px system-ui;cursor:pointer;" +
      "background:" + (bg || "#322530") + ";color:" + (fg || "#ffe9e2") + ";";
  }
  function dayBtn(label, n) { return '<button data-day="' + n + '" style="' + btnCss() + '">' + label + '</button>'; }
  function check(id, label, on) {
    return '<label style="display:flex;align-items:center;gap:8px;margin-bottom:7px;cursor:pointer">' +
      '<input type="checkbox" id="' + id + '"' + (on ? " checked" : "") + '> ' + label + '</label>';
  }

  /* ============================================================
     Editor de Contenido (códigos / ruleta / PIN / recompensas)
     Lee de PIVI_CONFIG y guarda en la nube (pivi_content) vía PiviContent.
     ============================================================ */
  function openContentEditor() {
    if (document.getElementById("piviContentEditor")) return;
    var cur = (window.PiviContent && PiviContent.current()) || { codigos: {}, ruleta: [], devPin: "", recompensasOverride: {} };
    var codigosText = Object.keys(cur.codigos || {}).map(function (k) { return k + "=" + cur.codigos[k]; }).join("\n");
    var ruletaText = (cur.ruleta || []).join(", ");
    var curOv = cur.recompensasOverride || {};
    var baseById = {};

    var inp = "width:100%;box-sizing:border-box;background:#251d24;color:#fff;border:1px solid #4a3645;border-radius:9px;padding:8px;margin-bottom:6px;font:600 13px system-ui;";
    var ta = function (h) { return inp + "min-height:" + h + "px;font-family:ui-monospace,Consolas,monospace;font-size:12px;"; };
    var lbl = function (t) { return '<div style="margin:10px 0 4px;color:#b094a0;font-weight:800;font-size:11px">' + t + '</div>'; };

    var hasCloud = !!(window.PiviContent && PiviContent.hasCloud);
    var cloudNote = hasCloud
      ? "💾 Se guardará en la nube y aparecerá en todos los dispositivos al instante."
      : "⚠️ Sin nube configurada: el cambio solo afecta a esta sesión.";
    var realWarn = hasCloud
      ? '<div style="margin:2px 0 8px;padding:8px 10px;border-radius:10px;background:#3a1f25;color:#ffc8dd;font-weight:700">' +
          '⚠️ Esto NO es el sandbox: cambia el contenido REAL (códigos, ruleta y recompensas) en los dos móviles.</div>'
      : "";

    var ov = document.createElement("div");
    ov.id = "piviContentEditor";
    ov.style.cssText = "position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px;";
    ov.innerHTML =
      '<div style="background:#1c1622;color:#ffe9e2;border:1px solid #4a3645;border-radius:16px;padding:18px;width:min(560px,100%);max-height:88vh;overflow:auto;font:600 13px/1.4 system-ui">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
          '<b style="font-size:15px">📦 Contenido</b><span style="flex:1"></span>' +
          '<button id="ceReload" style="' + btnCss() + '">↻ Recargar</button>' +
          '<button id="ceClose" style="' + btnCss("#ff7d8c", "#2a1016") + '">Cerrar</button>' +
        '</div>' +
        realWarn +
        lbl("🏷️ CÓDIGOS — una línea por código:  CODIGO=puntos") +
        '<textarea id="ceCodigos" spellcheck="false" style="' + ta(120) + '"></textarea>' +
        lbl("🎡 RULETA — 8 números separados por comas") +
        '<input id="ceRuleta" style="' + inp + '">' +
        lbl("🛠 PIN del modo Dev") +
        '<input id="cePin" style="' + inp + '">' +
        lbl("🎁 RECOMPENSAS — edita coste, disponibilidad y mensajes (toca ✏️)") +
        '<div id="ceRewards" style="margin-bottom:10px">Cargando recompensas…</div>' +
        '<button id="ceSave" style="' + btnCss("#8ac926", "#0f2a0a") + ';width:100%;padding:11px">💾 Guardar</button>' +
        '<div style="margin-top:8px;opacity:.7;font-size:11px">' + cloudNote + '</div>' +
      '</div>';
    document.body.appendChild(ov);

    // rellenar valores sin problemas de escape
    document.getElementById("ceCodigos").value = codigosText;
    document.getElementById("ceRuleta").value = ruletaText;
    document.getElementById("cePin").value = cur.devPin || "";

    // ---- lista editable de recompensas (carga recompensas.json) ----
    var cinp = "box-sizing:border-box;background:#251d24;color:#fff;border:1px solid #4a3645;border-radius:8px;padding:6px;font:600 12px system-ui;";
    var rewardsBox = document.getElementById("ceRewards");
    function dispBool(r) { return r.disponible !== false; }
    function buildRewardRow(base) {
      var id = String(base.id);
      var eff = Object.assign({}, base, curOv[id] || {});
      var row = document.createElement("div");
      row.className = "ce-rw";
      row.setAttribute("data-id", id);
      row.style.cssText = "border:1px solid #4a3645;border-radius:10px;padding:8px;margin-bottom:6px;";
      row.innerHTML =
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<span style="opacity:.5;font-size:11px;width:22px">#' + id + '</span>' +
          '<input class="ce-emoji" maxlength="8" style="width:46px;text-align:center;' + cinp + '">' +
          '<span style="opacity:.6;font-size:11px;min-width:70px">' + (base.tipo || "") + '</span>' +
          '<span style="flex:1"></span>' +
          '<label style="display:flex;align-items:center;gap:4px;font-size:11px"><input type="checkbox" class="ce-disp"> disp.</label>' +
          '<input type="number" class="ce-coste" style="width:62px;' + cinp + '">' +
          '<button type="button" class="ce-toggle" title="Editar mensajes" style="' + btnCss() + '">✏️</button>' +
        '</div>' +
        '<div class="ce-msgs" style="display:none;margin-top:6px">' +
          '<textarea class="ce-popup" placeholder="Mensaje al canjear" style="' + ta(46) + '"></textarea>' +
          '<textarea class="ce-hist" placeholder="Texto del historial" style="' + ta(34) + '"></textarea>' +
        '</div>';
      rewardsBox.appendChild(row);
      row.querySelector(".ce-emoji").value = eff.textoBoton || "";
      row.querySelector(".ce-coste").value = (eff.coste != null ? eff.coste : "");
      row.querySelector(".ce-disp").checked = dispBool(eff);
      row.querySelector(".ce-popup").value = eff.mensajePopup || "";
      row.querySelector(".ce-hist").value = eff.mensajeHistorico || "";
      row.querySelector(".ce-toggle").onclick = function () {
        var m = row.querySelector(".ce-msgs"); m.style.display = (m.style.display === "none" ? "block" : "none");
      };
    }
    fetch("recompensas.json", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (list) {
        rewardsBox.innerHTML = "";
        (list || []).forEach(function (b) { baseById[String(b.id)] = b; buildRewardRow(b); });
      })
      .catch(function () { rewardsBox.innerHTML = '<div style="opacity:.7;font-size:12px">No se pudo cargar recompensas.json.</div>'; });

    function close() { ov.remove(); }
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    document.getElementById("ceClose").onclick = close;
    document.getElementById("ceReload").onclick = function () {
      if (window.PiviContent && PiviContent.load) PiviContent.load().then(function () { close(); openContentEditor(); });
    };
    document.getElementById("ceSave").onclick = function () {
      var codigos = {};
      document.getElementById("ceCodigos").value.split(/\n+/).forEach(function (line) {
        line = line.trim(); if (!line) return;
        var eq = line.indexOf("=");
        if (eq > 0) { var k = line.slice(0, eq).trim(); var v = Number(line.slice(eq + 1).trim()); if (k && !isNaN(v)) codigos[k] = v; }
      });
      var ruletaRaw = document.getElementById("ceRuleta").value.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
      var ruleta = ruletaRaw.map(Number);
      // la rueda tiene 8 colores fijos: 8 números enteros entre 0 y 100
      var ruletaOk = ruleta.length === 8 && ruleta.every(function (x) { return Number.isInteger(x) && x >= 0 && x <= 100; });
      if (ruletaRaw.length && !ruletaOk) {
        window.alert("La ruleta necesita exactamente 8 números enteros (0 a 100) separados por comas. No se ha guardado nada.");
        return;
      }
      var pin = document.getElementById("cePin").value.trim();
      var ovObj = {};
      if (rewardsBox) rewardsBox.querySelectorAll(".ce-rw").forEach(function (row) {
        var id = row.getAttribute("data-id"); var base = baseById[id]; if (!base) return;
        var emoji = row.querySelector(".ce-emoji").value.trim();
        var costeStr = row.querySelector(".ce-coste").value;
        var coste = costeStr === "" ? base.coste : Number(costeStr);
        var disp = row.querySelector(".ce-disp").checked;
        var popup = row.querySelector(".ce-popup").value;
        var hist = row.querySelector(".ce-hist").value;
        var diff = {};
        if (emoji !== (base.textoBoton || "")) diff.textoBoton = emoji;
        if (Number(coste) !== Number(base.coste)) diff.coste = Number(coste);
        if (disp !== (base.disponible !== false)) diff.disponible = disp;
        if (popup !== (base.mensajePopup || "")) diff.mensajePopup = popup;
        if (hist !== (base.mensajeHistorico || "")) diff.mensajeHistorico = hist;
        if (Object.keys(diff).length) ovObj[id] = diff;
      });

      var content = {
        codigos: codigos,
        ruleta: ruleta.length ? ruleta : undefined,
        devPin: pin || undefined,
        recompensasOverride: ovObj
      };
      if (!window.PiviContent) { close(); return; }
      if (PiviContent.hasCloud && !window.confirm("Vas a cambiar el contenido REAL (no el sandbox): códigos, ruleta y recompensas para los dos móviles.\n\n¿Guardar?")) return;
      PiviContent.save(content).then(function () {
        if (window.PiviCore) PiviCore.toast("📦 Contenido guardado y sincronizado", 2400);
        close();
      }).catch(function (err) {
        if (window.PiviCore) PiviCore.toast("Aplicado local (sin nube): " + err.message, 2800);
        close();
      });
    };
  }

  /* ---------- arranque ---------- */
  function boot() {
    attachGesture();
    if (window.PIVI_DEV) { markDevUI(); buildBar(); }
    if (SANDBOX_FAILED) {
      setTimeout(function () {
        window.alert("🛠 El modo pruebas no puede aislar los datos en este navegador, así que se ha desactivado.\n\nNo se ha tocado nada real: estás en modo normal.");
      }, 300);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.PiviDev = { enable: enableDev, disable: disableDev, restoreReal: restoreRealSnapshot, isOn: function () { return !!window.PIVI_DEV; } };
})();
