/* ============================================================
   pivi-core.js — utilidades compartidas (sin reglas de negocio)
   ------------------------------------------------------------
   - Tema claro/oscuro (persistente)
   - Confeti + jingle reutilizables (PiviFX.celebrate)
   - Toast y formato de puntos
   - Helpers de fecha SOLO para pistas de UI
   - Móvil / app instalada: color de la barra del sistema,
     toques instantáneos (onTap), tablero a la vista al empezar
     y registro del service worker (sw.js)
   Las reglas reales (cuándo puntúa, candados…) viven en
   pivi-api.js / Supabase. Aquí solo presentación.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- LIMPIEZA: claves basura de versiones anteriores ----------------
     Antes se hacía "localStorage.setItem = function…" para vigilar los
     cambios. Safari (iPhone) y Firefox no lo permiten: en vez de cambiar
     el método GUARDABAN el texto de la función como un dato. Se borran. */
  try {
    ["getItem", "setItem", "removeItem", "clear", "key"].forEach(function (n) {
      var v = Storage.prototype.getItem.call(localStorage, n);
      if (typeof v === "string" && /^\s*(function|\()/.test(v)) Storage.prototype.removeItem.call(localStorage, n);
    });
  } catch (e) { /* sin almacenamiento */ }

  /* ---------------- TEMA ---------------- */
  var THEME_KEY = "pivi_theme";
  function preferred() {
    var saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  var THEME_BAR = { light: "#fbf4ef", dark: "#1f1820" }; // = --bg de theme.css
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    // barra de estado del móvil / ventana de la app, del mismo color que el fondo
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEME_BAR[t] || THEME_BAR.light);
    var btns = document.querySelectorAll("[data-theme-toggle]");
    btns.forEach(function (b) {
      b.textContent = t === "dark" ? "☀️" : "🌙";
      b.setAttribute("aria-label", t === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro");
      b.title = b.getAttribute("aria-label");
    });
  }
  function toggleTheme() {
    var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  }
  // Aplica cuanto antes para evitar parpadeo
  applyTheme(preferred());
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-theme-toggle]");
    if (t) toggleTheme();
  });

  /* ---------------- FORMATO / PUNTOS UI ---------------- */
  function setPointsUI(value, opts) {
    var v = Number(value) || 0;
    document.querySelectorAll("[data-points], #points").forEach(function (el) {
      var prev = Number(el.textContent.replace(/[^\d-]/g, "")) || 0;
      el.textContent = String(v);
      if (opts && opts.bump && v !== prev) {
        var chip = el.closest(".points-chip") || el;
        chip.classList.remove("bump");
        void chip.offsetWidth; // reflow
        chip.classList.add("bump");
      }
    });
  }

  /* ---------------- TOAST ---------------- */
  var toastTimer = null;
  function toast(msg, ms) {
    var el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast hidden";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = "toast";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add("hidden"); }, ms || 1400);
  }

  /* ---------------- CONFETI ---------------- */
  function ensureCanvas() {
    var c = document.getElementById("fxCanvas");
    if (!c) {
      c = document.createElement("canvas");
      c.id = "fxCanvas";
      c.className = "fx-canvas";
      c.setAttribute("aria-hidden", "true");
      document.body.appendChild(c);
    }
    return c;
  }
  var fxAnim = null;
  function confetti(opts) {
    if (typeof opts === "number") opts = { duration: opts };
    opts = opts || {};
    var durationMs = opts.duration || 2400;
    var count = opts.count || 280;
    var emojiSet = opts.emojis || ["💖", "💕", "✨", "🌸"];
    var emojiChance = opts.emojiChance != null ? opts.emojiChance : 0.12;

    var canvas = ensureCanvas();
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    var dpr = Math.max(1, window.devicePixelRatio || 1);
    var W = window.innerWidth, H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.display = "block";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (fxAnim) cancelAnimationFrame(fxAnim);
    var cx = W / 2, cy = Math.min(H * 0.34, 240);
    var colors = ["#ff6b81", "#ffb4a2", "#ffd6a5", "#caffbf", "#9bf6ff", "#a0c4ff", "#ffc8dd", "#bdb2ff"];
    var P = [];
    for (var i = 0; i < count; i++) {
      var a = Math.random() * Math.PI - Math.PI / 2;
      var s = 7 + Math.random() * 13;
      var emoji = Math.random() < emojiChance ? emojiSet[(Math.random() * emojiSet.length) | 0] : null;
      P.push({
        x: cx, y: cy,
        vx: Math.cos(a) * s + (Math.random() - .5) * 3.2,
        vy: Math.sin(a) * s - Math.random() * 4.5,
        g: .15 + Math.random() * .18,
        w: 6 + Math.random() * 10, h: 3 + Math.random() * 6,
        rot: Math.random() * Math.PI, vr: (Math.random() - .5) * .35,
        color: colors[(Math.random() * colors.length) | 0],
        emoji: emoji, size: 16 + Math.random() * 16
      });
    }
    var start = performance.now();
    (function frame(t) {
      var el = t - start;
      var fade = el > durationMs - 500 ? Math.max(0, (durationMs - el) / 500) : 1;
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = fade;
      for (var k = 0; k < P.length; k++) {
        var p = P[k];
        p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        p.vx *= .991; p.vy *= .999;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        if (p.emoji) { ctx.font = p.size + "px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(p.emoji, 0, 0); }
        else { ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      if (el < durationMs) fxAnim = requestAnimationFrame(frame);
      else { ctx.clearRect(0, 0, W, H); canvas.style.display = "none"; fxAnim = null; }
    })(start);
  }

  /* ---------------- POP grande de emoji (recompensa) ---------------- */
  function bigEmojiPop(emoji) {
    if (!document.body) return;
    var el = document.createElement("div");
    el.textContent = emoji || "🎁";
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = "position:fixed;left:50%;top:40%;z-index:1200;pointer-events:none;" +
      "font-size:clamp(84px,22vw,190px);line-height:1;filter:drop-shadow(0 12px 26px rgba(0,0,0,.35));will-change:transform,opacity;";
    document.body.appendChild(el);
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    var frames = reduce
      ? [{ transform: "translate(-50%,-50%) scale(1)", opacity: 1 }, { transform: "translate(-50%,-50%) scale(1)", opacity: 0 }]
      : [
        { transform: "translate(-50%,-50%) scale(.2) rotate(-20deg)", opacity: 0 },
        { transform: "translate(-50%,-50%) scale(1.18) rotate(8deg)", opacity: 1, offset: .32 },
        { transform: "translate(-50%,-50%) scale(.98) rotate(-3deg)", opacity: 1, offset: .52 },
        { transform: "translate(-50%,-58%) scale(1.04) rotate(0deg)", opacity: 1, offset: .78 },
        { transform: "translate(-50%,-78%) scale(.9) rotate(0deg)", opacity: 0 }
      ];
    var anim = el.animate(frames, { duration: reduce ? 900 : 2000, easing: "cubic-bezier(.22,1,.36,1)" });
    anim.onfinish = function () { el.remove(); };
  }

  /* ---------------- Fanfarria (canje de recompensa) ---------------- */
  function fanfare() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var ctx = audioCtx, t0 = ctx.currentTime;
      var master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, t0);
      master.gain.exponentialRampToValueAtTime(0.3, t0 + 0.03);
      master.connect(ctx.destination);
      function tone(freq, start, dur, type, gain) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type || "triangle";
        o.frequency.setValueAtTime(freq, t0 + start);
        g.gain.setValueAtTime(0.0001, t0 + start);
        g.gain.exponentialRampToValueAtTime(gain || 0.4, t0 + start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
        o.connect(g); g.connect(master);
        o.start(t0 + start); o.stop(t0 + start + dur + 0.05);
      }
      // melodía ascendente triunfal (C E G C)
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
        tone(f, i * 0.12, 0.24, "square", 0.32);
        tone(f / 2, i * 0.12, 0.24, "triangle", 0.22);
      });
      // acorde mayor final sostenido
      [523.25, 659.25, 783.99, 1318.51].forEach(function (f) { tone(f, 0.52, 0.95, "triangle", 0.26); });
      // chispitas agudas
      [1568, 2093, 2637].forEach(function (f, i) { tone(f, 0.56 + i * 0.08, 0.32, "sine", 0.15); });
      master.gain.setValueAtTime(0.3, t0 + 1.4);
      master.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.7);
    } catch (e) { /* sin sonido */ }
  }

  /* Celebración especial de recompensa: confeti + emoji gigante + fanfarria */
  function celebrateReward(emoji) {
    confetti({ duration: 3200, count: 440, emojis: [emoji || "🎁", "✨", "🎉", "💖", "🌟"], emojiChance: 0.42 });
    bigEmojiPop(emoji);
    fanfare();
  }

  /* ---------------- SONIDO ---------------- */
  var audioCtx = null;
  function jingle() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var now = audioCtx.currentTime;
      var master = audioCtx.createGain();
      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
      master.connect(audioCtx.destination);
      var o1 = audioCtx.createOscillator(), o2 = audioCtx.createOscillator();
      o1.type = "square"; o2.type = "triangle";
      var g1 = audioCtx.createGain(), g2 = audioCtx.createGain();
      g1.gain.value = 0.9; g2.gain.value = 0.55;
      o1.connect(g1); g1.connect(master); o2.connect(g2); g2.connect(master);
      var seq = [523.25, 659.25, 783.99, 987.77, 1046.5, 1318.51], step = 0.09;
      seq.forEach(function (f, i) { var t = now + i * step; o1.frequency.setValueAtTime(f, t); o2.frequency.setValueAtTime(f / 2, t); });
      o1.frequency.linearRampToValueAtTime(1567.98, now + seq.length * step + 0.08);
      o2.frequency.linearRampToValueAtTime(783.99, now + seq.length * step + 0.08);
      o1.start(now); o2.start(now); o1.stop(now + 0.95); o2.stop(now + 0.95);
    } catch (e) { /* sin sonido */ }
  }

  function celebrate(opts) {
    opts = opts || {};
    confetti(opts.duration || 2400);
    if (opts.sound !== false) jingle();
  }

  /* ---------------- TOQUE INSTANTÁNEO ----------------
     Para juegos de velocidad (reflejos, atrapa, simón): reacciona al
     APOYAR el dedo (pointerdown) y no al levantarlo (click), que en el
     móvil llega tarde o se pierde si el dedo se mueve un poco.
     El teclado (Enter/Espacio sobre un botón) sigue funcionando. */
  function onTap(el, fn) {
    if (!el) return;
    if (!window.PointerEvent) { el.addEventListener("click", fn); return; }
    el.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      fn(e);
    });
    el.addEventListener("click", function (e) {
      if (e.detail === 0) fn(e); // click de teclado o lector de pantalla
    });
  }

  /* ---------------- MÓVIL: TABLERO A LA VISTA ----------------
     Al empezar una partida en el móvil, desplaza la página para que
     se vean a la vez los datos (tiempo, aciertos…) y el tablero. */
  var START_IDS = ["choosePractice", "chooseChallenge", "practiceBtn", "challengeBtn", "startBtn", "restartBtn", "newBtn", "modalAgain"];
  function isPhone() {
    return window.matchMedia && matchMedia("(max-width: 760px)").matches;
  }
  function focusGame() {
    var anchor = document.querySelector(".panel .info");
    if (!anchor || !isPhone()) return;
    // si se abrió un aviso (p. ej. "⛔ No disponible"), no movemos nada
    var open = document.querySelector(".overlay:not(.hidden)");
    if (open) return;
    var top = anchor.getBoundingClientRect().top;
    var headerH = (document.querySelector(".app-header") || { offsetHeight: 64 }).offsetHeight;
    if (top > headerH + 4 && top < headerH + 40) return; // ya está en su sitio
    var calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    anchor.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("button");
    if (b && START_IDS.indexOf(b.id) !== -1) setTimeout(focusGame, 80);
  });

  /* ---------------- RETO EN CURSO: no salir sin querer ----------------
     Cada juego registra cómo saber si hay un reto a medias. Mientras lo
     haya, tocar un enlace (⬅️, 🏠, logo, pestañas) pide confirmación y
     el navegador avisa antes de recargar o cerrar la página. */
  var guardFn = null;
  function guardChallenge(isRunning) { guardFn = isRunning; }
  function challengeRunning() { try { return !!(guardFn && guardFn()); } catch (e) { return false; } }
  var LEAVE_MSG = "Tienes un reto a medias: si sales ahora se pierde (0 puntos) y no se puede repetir este finde.\n\n¿Salir igualmente?";
  function confirmLeave(msg) {
    if (!challengeRunning()) return true;
    return window.confirm(msg || LEAVE_MSG);
  }
  var leaveOk = false; // ya confirmó al tocar el enlace: no preguntar dos veces
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || !challengeRunning()) return;
    if (!confirmLeave()) { e.preventDefault(); e.stopImmediatePropagation(); }
    else { leaveOk = true; setTimeout(function () { leaveOk = false; }, 1500); }
  }, true);
  window.addEventListener("beforeunload", function (e) {
    if (challengeRunning() && !leaveOk) { e.preventDefault(); e.returnValue = ""; }
  });

  /* ---------------- "▶ EMPEZAR": el juego no arranca solo ----------------
     Al elegir modo, el tablero se queda quieto con un botón grande encima.
     Al tocarlo: opts.onBegin() (p. ej. gastar el reto; si devuelve false
     no se empieza), cuenta atrás 3·2·1 y opts.onStart() arranca el juego.
     Solo hay una puerta a la vez: abrir otra (cambiar de modo) cierra la anterior. */
  var gate = null;
  function cancelGate() { if (gate) { var g = gate; gate = null; g.close(); } }
  function readyGate(container, opts) {
    cancelGate();
    opts = opts || {};
    if (!container) { if (!opts.onBegin || opts.onBegin() !== false) { if (opts.onStart) opts.onStart(); } return null; }

    var el = document.createElement("div");
    el.className = "ready-gate";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn primary ready-btn";
    btn.textContent = "▶ " + (opts.label || "Empezar");
    el.appendChild(btn);
    if (opts.hint) {
      var hint = document.createElement("div");
      hint.className = "ready-hint";
      hint.textContent = opts.hint;
      el.appendChild(hint);
    }
    container.classList.add("ready-host");
    container.appendChild(el);

    var timers = [];
    var g = {
      close: function () {
        timers.forEach(clearTimeout);
        if (el.parentNode) el.parentNode.removeChild(el);
        container.classList.remove("ready-host");
      }
    };
    gate = g;

    // que el toque en la puerta no llegue al tablero (p. ej. el panel de Reflejos)
    el.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    btn.addEventListener("click", function () {
      if (gate !== g) return;
      if (opts.onBegin && opts.onBegin() === false) { cancelGate(); return; }
      var n = opts.countdown === 0 ? 0 : (opts.countdown || 3);
      var calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
      function go() { if (gate !== g) return; gate = null; g.close(); if (opts.onStart) opts.onStart(); }
      if (!n || calm) { go(); return; }
      el.innerHTML = "";
      var count = document.createElement("div");
      count.className = "ready-count";
      el.appendChild(count);
      (function tick(k) {
        if (gate !== g) return;
        count.textContent = k > 0 ? String(k) : "¡Ya!";
        count.style.animation = "none"; void count.offsetWidth; count.style.animation = "";
        timers.push(setTimeout(function () { if (k > 0) tick(k - 1); else go(); }, k > 0 ? 520 : 320));
      })(n);
    });
    setTimeout(function () { try { btn.focus({ preventScroll: true }); } catch (e) {} }, 0);
    return g;
  }

  /* ---------------- VENTANA DE INICIO DE LOS JUEGOS: poder salir ----------------
     "¿Cómo quieres jugar?" no obligaba a elegir: ahora tiene ✕ (cerrar y
     ver el juego/reglas), "Volver a Retos", toque fuera y tecla Esc. */
  function enhanceStartModal() {
    var ov = document.querySelector(".start-overlay");
    if (!ov || ov.getAttribute("data-enhanced")) return;
    ov.setAttribute("data-enhanced", "1");
    var modal = ov.querySelector(".start-modal");
    var actions = ov.querySelector(".start-actions");
    function close() { ov.classList.add("hidden"); }
    if (modal) {
      var x = document.createElement("button");
      x.type = "button";
      x.className = "modal-close";
      x.setAttribute("aria-label", "Cerrar");
      x.title = "Cerrar";
      x.textContent = "✕";
      x.addEventListener("click", close);
      modal.insertBefore(x, modal.firstChild);
    }
    if (actions) {
      var back = document.createElement("a");
      back.className = "btn ghost";
      back.href = "retos.html";
      back.textContent = "⬅️ Volver a Retos";
      actions.appendChild(back);
    }
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !ov.classList.contains("hidden")) close();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", enhanceStartModal);
  else enhanceStartModal();

  /* ---------------- APP INSTALABLE (service worker) ---------------- */
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () { /* sin modo offline */ });
    });
  }

  /* ---------------- FECHAS (solo pistas de UI) ---------------- */
  var DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  function isoDate(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function isWeekend(d) { var n = (d || new Date()).getDay(); return n === 0 || n === 6; }
  function isWheelDay(d) { var n = (d || new Date()).getDay(); return n === 1 || n === 3; }
  function dayName(d) { return DAYS[(d || new Date()).getDay()]; }

  window.PiviCore = {
    applyTheme: applyTheme, toggleTheme: toggleTheme, preferred: preferred,
    setPointsUI: setPointsUI, toast: toast, onTap: onTap, focusGame: focusGame,
    guardChallenge: guardChallenge, confirmLeave: confirmLeave, challengeRunning: challengeRunning,
    readyGate: readyGate, cancelGate: cancelGate,
    celebrate: celebrate, celebrateReward: celebrateReward,
    confetti: confetti, jingle: jingle, fanfare: fanfare, bigEmojiPop: bigEmojiPop,
    isoDate: isoDate, isWeekend: isWeekend, isWheelDay: isWheelDay, dayName: dayName, DAYS: DAYS
  };
  window.PiviFX = { celebrate: celebrate, celebrateReward: celebrateReward }; // alias retro-compat
})();
