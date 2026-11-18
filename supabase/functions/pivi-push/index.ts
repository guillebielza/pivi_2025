// @ts-nocheck
/* ============================================================
   pivi-push — Avisos de Pivi (notificaciones push en el móvil)
   ------------------------------------------------------------
   Función de Supabase (Edge Function, Deno). Cada vez que la llaman,
   REVISA la nube y envía lo que toque. No se fía de lo que le manden:
   todo lo saca de la base de datos, así que llamarla de más no hace
   daño (lo ya avisado queda apuntado y no se repite).

   Quién la llama (ver supabase/avisos.sql):
     - Disparadores: cambia el estado (pivi_state), el catálogo
       (pivi_content), llega una nota (pivi_notas) o un móvil nuevo
       se apunta (pivi_push).
     - Reloj (pg_cron, cada 15 min): recordatorios de ruleta y retos.
     - La web: GET → clave pública para apuntarse a los avisos.

   Qué avisa (cada móvil elige en «🔔 Avisos»):
     ruleta  lunes y miércoles 10:00 y 21:00, si aún no se ha tirado
     finde   sábado 10:00 (retos abiertos) y domingo 18:00 (si quedan)
     pareja  lo que hace el otro dispositivo (puntos, partidas, canjes)
     premios al llegar a un nivel y cuando hay premios nuevos
     notas   mensajes de pivi_notas (modo Dev o «aviso de prueba»)
   De 23:00 a 8:00 no se avisa de lo automático: se guarda y llega
   por la mañana. Las notas llegan siempre.

   Claves VAPID: se crean aquí la primera vez y se guardan en la
   tabla privada pivi_push_server. La privada nunca sale de Supabase
   (ni pasa por el repo, que es público).

   Desplegar con «Verify JWT» DESACTIVADO (la llaman la base de datos
   y la web sin token).
   ============================================================ */

const ZONA = "Europe/Madrid";
const CONTACTO = "https://guillebielza.github.io/pivi_2025/"; // "sub" de VAPID
// = PointsPolicy.GAMES (juegos ACTIVOS de points-policy.js). Al añadir o
// retirar un juego, cámbialo también aquí.
const JUEGOS = ["wordle", "quiz", "simon", "reflejos", "muro", "vuelo", "cita"];
const NIVELES = [
  { nombre: "Pequeño", coste: 50, emoji: "🌱" },
  { nombre: "Mediano", coste: 85, emoji: "🌷" },
  { nombre: "Grande", coste: 135, emoji: "🌟" },
  { nombre: "Especial", coste: 185, emoji: "💎" }
];
const RULETA = [1, 4, 6, 0, 8, 4, 6, 1];
const ICONOS = {
  wheel: "🎡", code: "🏷️", reward: "🎁",
  quiz: "🧩", wordle: "🟩", memory: "🧠", missing: "👀",
  simon: "🎵", reflejos: "⚡", atrapa: "💘", muro: "💗", vuelo: "💌", cita: "🌹"
};
const HORA = 3600 * 1000;

const ENV = (k) => (globalThis.Deno ? Deno.env.get(k) : "") || "";

/* ============================================================
   Web Push: cifrado (RFC 8291, aes128gcm) y firma VAPID (RFC 8292)
   Solo Web Crypto: funciona igual en Deno y en el navegador.
   ============================================================ */
const te = new TextEncoder();

export function b64u(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function unir(...partes) {
  const len = partes.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of partes) { out.set(p, o); o += p.length; }
  return out;
}
async function hkdf(salt, ikm, info, bytes) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, bytes * 8));
}

/* Cifra el texto para una suscripción. «fijo» (solo pruebas) permite
   dar la clave efímera y la sal del ejemplo del RFC 8291. */
export async function cifrar(texto, p256dh, auth, fijo) {
  const uaPub = unb64u(p256dh);
  const secreto = unb64u(auth);
  let priv, asPub;
  if (fijo) {
    const p = unb64u(fijo.asPublic);
    priv = await crypto.subtle.importKey("jwk", {
      kty: "EC", crv: "P-256", x: b64u(p.slice(1, 33)), y: b64u(p.slice(33, 65)), d: fijo.asPrivate
    }, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    asPub = p;
  } else {
    const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    priv = kp.privateKey;
    asPub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  }
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, priv, 256));
  const ikm = await hkdf(secreto, ecdh, unir(te.encode("WebPush: info\0"), uaPub, asPub), 32);
  const sal = fijo ? unb64u(fijo.salt) : crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(sal, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(sal, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const k = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // un solo registro: texto + delimitador 0x02 (último registro), sin relleno
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, k, unir(te.encode(texto), new Uint8Array([2]))));
  // cabecera: sal (16) · tamaño de registro 4096 (4) · long. clave (1) · clave efímera (65)
  return unir(sal, new Uint8Array([0, 0, 16, 0, asPub.length]), asPub, cifrado);
}

export async function nuevasClaves() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const j = await crypto.subtle.exportKey("jwk", kp.privateKey);
  return {
    jwk: { kty: "EC", crv: "P-256", x: j.x, y: j.y, d: j.d },
    publica: b64u(unir(new Uint8Array([4]), unb64u(j.x), unb64u(j.y))),
    creada: new Date().toISOString()
  };
}

const firmas = new Map(); // audiencia → {h, exp}: se reutiliza mientras le quede más de 1 h
export async function cabeceraVapid(endpoint, claves) {
  const aud = new URL(endpoint).origin;
  const ya = firmas.get(aud);
  if (ya && ya.clave === claves.publica && ya.exp * 1000 - Date.now() > HORA) return ya.h;
  const cab = b64u(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const datos = b64u(te.encode(JSON.stringify({ aud, exp, sub: CONTACTO })));
  const k = await crypto.subtle.importKey("jwk", claves.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const firma = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k, te.encode(cab + "." + datos));
  const h = "vapid t=" + cab + "." + datos + "." + b64u(firma) + ", k=" + claves.publica;
  firmas.set(aud, { h, exp, clave: claves.publica });
  return h;
}

/* ============================================================
   Base de datos (REST de Supabase con la clave de servicio)
   ============================================================ */
function claveServicio() {
  // proyectos con claves nuevas: SUPABASE_SECRET_KEYS = {"default":"sb_secret_…"}
  try {
    const o = JSON.parse(ENV("SUPABASE_SECRET_KEYS") || "{}");
    const k = o.default || Object.values(o)[0];
    if (k) return k;
  } catch (_) { /* nada */ }
  return ENV("SUPABASE_SERVICE_ROLE_KEY");
}
const q = (v) => encodeURIComponent(v);

async function db(ruta, op = {}) {
  const clave = claveServicio();
  const h = { apikey: clave, "Content-Type": "application/json" };
  if (/^eyJ/.test(clave)) h.Authorization = "Bearer " + clave;
  if (op.prefer) h.Prefer = op.prefer;
  const r = await fetch(ENV("SUPABASE_URL") + "/rest/v1/" + ruta, {
    method: op.method || "GET", headers: h,
    body: op.body === undefined ? undefined : JSON.stringify(op.body)
  });
  const txt = await r.text();
  if (!r.ok) throw new Error((op.method || "GET") + " " + ruta.split("?")[0] + " → HTTP " + r.status + " " + txt.slice(0, 200));
  return txt ? JSON.parse(txt) : null;
}

async function clavesVapid() {
  let filas = await db("pivi_push_server?id=eq.vapid&select=data");
  if (!filas.length) {
    // primera vez: se crean aquí. Si dos llamadas coinciden, gana la
    // primera en guardarse y las dos usan esa (ignore-duplicates + releer).
    await db("pivi_push_server", {
      method: "POST", body: [{ id: "vapid", data: await nuevasClaves() }],
      prefer: "resolution=ignore-duplicates,return=minimal"
    });
    filas = await db("pivi_push_server?id=eq.vapid&select=data");
  }
  return filas[0].data;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/* Una sola revisión a la vez por perfil (si coinciden dos llamadas, la
   segunda espera a que acabe la primera y luego revisa lo que quede). */
async function bloquear(perfil) {
  const id = "meta:" + perfil;
  await db("pivi_push_server", { method: "POST", body: [{ id, data: {} }], prefer: "resolution=ignore-duplicates,return=minimal" });
  for (let i = 0; i < 20; i++) {
    const ahora = new Date().toISOString();
    const filas = await db(
      "pivi_push_server?id=eq." + q(id) + "&or=" + q('(lock_until.is.null,lock_until.lt."' + ahora + '")') + "&select=data",
      { method: "PATCH", body: { lock_until: new Date(Date.now() + 45000).toISOString() }, prefer: "return=representation" }
    );
    if (filas && filas.length) return filas[0].data || {};
    await esperar(1500);
  }
  return null;
}
async function soltar(perfil, m) {
  await db("pivi_push_server?id=eq." + q("meta:" + perfil), {
    method: "PATCH", body: { data: m, lock_until: null, updated_at: new Date().toISOString() }, prefer: "return=minimal"
  });
}

/* ============================================================
   Qué toca avisar
   ============================================================ */
export function hora(d = new Date()) {
  const p = {};
  new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short"
  }).formatToParts(d).forEach((x) => { p[x.type] = x.value; });
  const h = Number(p.hour) % 24, min = Number(p.minute);
  return {
    fecha: p.year + "-" + p.month + "-" + p.day,
    dia: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), // 0 = domingo
    h, mins: h * 60 + min
  };
}
function diaAntes(fecha) {
  const d = new Date(fecha + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
const esNoche = (t) => t.h >= 23 || t.h < 8;
function leerJSON(s, def) { try { const v = typeof s === "string" ? JSON.parse(s) : s; return v == null ? def : v; } catch (_) { return def; } }
// lo mismo que PiviLedger.isHidden: pruebas, anulados y correcciones
const oculto = (e) => !e || !!e.dev || e.type === "fix" || e.device === "pareja-sim" || /^undo-/.test(String(e.id));

function nivelesDe(cont) {
  const n = Array.isArray(cont.niveles) && cont.niveles.length ? cont.niveles : NIVELES;
  return n.map((x) => ({ nombre: x.nombre || "", coste: Number(x.coste) || 0, emoji: x.emoji || "🎁" }))
    .filter((x) => x.coste > 0).sort((a, b) => a.coste - b.coste);
}
function nombrePremio(r) {
  if (r && r.mensajeHistorico) return String(r.mensajeHistorico).split("—")[0].trim();
  return r && r.nombre ? r.nombre : (r && r.tipo ? r.tipo : "Premio") + " de " + (r && r.coste) + " pts";
}

export function textoPareja(evs) {
  const linea = (e) => (ICONOS[e.type] || "•") + " " + (e.label || e.type) + (e.delta > 0 ? " (+" + e.delta + ")" : "");
  if (evs.length === 1) {
    const e = evs[0];
    if (e.type === "reward") {
      return { titulo: "🎁 Tu pareja ha canjeado un premio", cuerpo: String(e.label || "").replace(/^Canje:\s*/, ""), url: "recuerdos.html" };
    }
    return { titulo: "💞 Tu pareja", cuerpo: linea(e), url: "index.html#actividad" };
  }
  const pts = evs.reduce((s, e) => s + (e.delta > 0 ? Number(e.delta) : 0), 0);
  const ult = evs.slice(-3).map(linea);
  if (evs.length > 3) ult.push("… y " + (evs.length - 3) + " más");
  return {
    titulo: pts > 0 ? "💞 Tu pareja ha sumado +" + pts + " pts" : "💞 Novedades de tu pareja",
    cuerpo: ult.join("\n"), url: "index.html#actividad"
  };
}

export function recordatorios(st, cont, t, enviados) {
  const out = [];
  const entre = (h1, h2) => t.mins >= h1 * 60 && t.mins < h2 * 60;
  const una = (clave, aviso) => {
    if (enviados[clave]) return;
    enviados[clave] = new Date().toISOString();
    out.push(aviso);
  };
  if (t.dia === 1 || t.dia === 3) {
    const tirada = st[t.dia === 1 ? "wheel_spin_monday" : "wheel_spin_wednesday"] === t.fecha;
    const valores = Array.isArray(cont.ruleta) && cont.ruleta.length ? cont.ruleta.map(Number) : RULETA;
    if (!tirada && entre(10, 14)) {
      una("ruleta-a:" + t.fecha, {
        tipo: "ruleta", titulo: "🎡 ¡Hoy toca ruleta!",
        cuerpo: "Una tirada para los dos, hasta " + Math.max(...valores) + " pts. ¿Quién la tira?",
        url: "index.html#ruleta", ttl: 4 * HORA
      });
    }
    if (!tirada && entre(21, 23)) {
      una("ruleta-b:" + t.fecha, {
        tipo: "ruleta", titulo: "🎡 La ruleta sigue esperando",
        cuerpo: "Hoy se puede tirar hasta medianoche.", url: "index.html#ruleta", ttl: 2 * HORA
      });
    }
  }
  if (t.dia === 6 || t.dia === 0) {
    const sab = t.dia === 6 ? t.fecha : diaAntes(t.fecha); // el finde se apunta con la fecha del sábado
    const quedan = JUEGOS.filter((g) => st["weekend_played_" + g] !== sab).length;
    if (quedan && t.dia === 6 && entre(10, 14)) {
      una("finde-a:" + sab, {
        tipo: "finde", titulo: "🎮 ¡Retos del finde abiertos!",
        cuerpo: quedan === JUEGOS.length
          ? JUEGOS.length + " juegos, un intento cada uno. ¡Suerte!"
          : "Os quedan " + quedan + " de " + JUEGOS.length + " juegos este finde.",
        url: "retos.html", ttl: 6 * HORA
      });
    }
    if (quedan && t.dia === 0 && entre(18, 21)) {
      una("finde-b:" + sab, {
        tipo: "finde", titulo: "⏳ " + (quedan === 1 ? "Queda 1 reto" : "Quedan " + quedan + " retos") + " del finde",
        cuerpo: "Se cierran a medianoche. ¡A por ellos!", url: "retos.html", ttl: 5 * HORA
      });
    }
  }
  return out;
}

/* ============================================================
   Revisión de un perfil
   ============================================================ */
async function revisarPerfil(perfil, subs, claves) {
  const m = await bloquear(perfil);
  if (!m) return { ocupado: true };
  const t = hora(globalThis.__piviAhora ? new Date(globalThis.__piviAhora) : new Date()); // (__piviAhora: solo pruebas)
  const avisos = [];
  let enviados = 0;
  try {
    const st = ((await db("pivi_state?profile_id=eq." + q(perfil) + "&select=state"))[0] || {}).state || {};
    const cont = ((await db("pivi_content?id=eq." + q(perfil) + "&select=content"))[0] || {}).content || {};
    const primera = !m.iniciado; // la 1.ª vez solo se toma nota de lo que hay (no se avisa del pasado)
    m.enviados = m.enviados || {};

    // 1) lo que ha hecho el otro dispositivo
    const log = leerJSON(st.activityLog, []).filter((e) => e && e.id);
    const ids = new Set(log.map((e) => e.id));
    const vistos = new Set((m.vistos || []).filter((id) => ids.has(id)));
    if (primera) log.forEach((e) => vistos.add(e.id));
    else if (!esNoche(t)) {
      const nuevos = log.filter((e) => !vistos.has(e.id));
      nuevos.forEach((e) => vistos.add(e.id));
      const porDisp = new Map();
      nuevos
        .filter((e) => !oculto(e) && Date.now() - Date.parse(e.ts) < 36 * HORA)
        .sort((a, b) => (a.ts < b.ts ? -1 : 1))
        .forEach((e) => { if (!porDisp.has(e.device)) porDisp.set(e.device, []); porDisp.get(e.device).push(e); });
      porDisp.forEach((evs, disp) => avisos.push({ tipo: "pareja", excepto: disp, ttl: 24 * HORA, ...textoPareja(evs) }));
    }
    m.vistos = [...vistos];

    // 2) premios: nivel alcanzado
    const puntos = Number(st.points) || 0;
    if (primera || typeof m.puntos !== "number") m.puntos = puntos;
    else if (!esNoche(t)) {
      const cruzados = nivelesDe(cont).filter((n) => m.puntos < n.coste && n.coste <= puntos);
      if (cruzados.length) {
        const n = cruzados[cruzados.length - 1];
        avisos.push({
          tipo: "premios", titulo: n.emoji + " ¡Ya llegáis a un premio " + n.nombre.toLowerCase() + "!",
          cuerpo: "Tenéis " + puntos + " pts: ya podéis canjear premios de " + n.coste + ". 🎁",
          url: "premios.html", ttl: 24 * HORA
        });
      }
      m.puntos = puntos;
    }

    // 3) premios nuevos en el catálogo (solo cuando el catálogo vive en la nube)
    if (Array.isArray(cont.recompensas)) {
      const cat = cont.recompensas.filter((r) => r && r.disponible !== false && !r.retirado);
      const idsCat = cat.map((r) => String(r.id));
      if (primera || !Array.isArray(m.catalogo)) m.catalogo = idsCat;
      else if (!esNoche(t)) {
        const nuevos = cat.filter((r) => m.catalogo.indexOf(String(r.id)) === -1);
        if (nuevos.length) {
          avisos.push({
            tipo: "premios",
            titulo: nuevos.length === 1 ? "✨ Premio nuevo en Pivi" : "✨ " + nuevos.length + " premios nuevos en Pivi",
            cuerpo: nuevos.slice(0, 3).map((r) => (r.emoji || r.textoBoton || "🎁") + " " + nombrePremio(r)).join("\n"),
            url: "premios.html", ttl: 24 * HORA
          });
        }
        m.catalogo = idsCat;
      }
    }

    // 4) recordatorios por la hora
    avisos.push(...recordatorios(st, cont, t, m.enviados));
    const limite = Date.now() - 10 * 24 * HORA;
    Object.keys(m.enviados).forEach((k) => { if (Date.parse(m.enviados[k]) < limite) delete m.enviados[k]; });

    // 5) notas (llegan siempre, también de noche)
    const notas = await db("pivi_notas?profile_id=eq." + q(perfil) + "&sent_at=is.null&select=*&order=id.asc&limit=10");
    notas.forEach((n) => avisos.push({
      tipo: "notas", nota: n.id, para: n.to_device || null, excepto: n.to_device ? null : n.from_device,
      titulo: "💌 " + (n.titulo || "Nota para ti"), cuerpo: n.texto, url: "index.html",
      ttl: 4 * 24 * HORA, urgencia: "high", tag: "nota-" + n.id
    }));

    // enviar
    for (const a of avisos) {
      const dest = subs.filter((s) => a.para
        ? s.device_id === a.para
        : s.device_id !== a.excepto && !(s.prefs && s.prefs[a.tipo] === false));
      let ok = 0;
      for (const s of dest) if (await enviarA(s, a, claves)) ok++;
      enviados += ok;
      if (a.nota) {
        await db("pivi_notas?id=eq." + a.nota, {
          method: "PATCH", body: { sent_at: new Date().toISOString(), resultado: ok + "/" + dest.length }, prefer: "return=minimal"
        });
      }
    }
    m.iniciado = m.iniciado || new Date().toISOString();
  } finally {
    await soltar(perfil, m);
  }
  return { avisos: avisos.map((a) => a.tipo), enviados };
}

async function enviarA(s, a, claves) {
  const marcar = (campos) => db("pivi_push?endpoint=eq." + q(s.endpoint), { method: "PATCH", body: campos, prefer: "return=minimal" }).catch(() => {});
  try {
    const datos = JSON.stringify({ t: a.titulo, b: a.cuerpo, tag: a.tag || a.tipo, url: a.url || "index.html" });
    const cuerpo = await cifrar(datos, s.sub.keys.p256dh, s.sub.keys.auth);
    const r = await fetch(s.endpoint, {
      method: "POST",
      headers: {
        Authorization: await cabeceraVapid(s.endpoint, claves),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(Math.round((a.ttl || 12 * HORA) / 1000)),
        Urgency: a.urgencia || "normal"
      },
      body: cuerpo
    });
    if (r.status === 404 || r.status === 410) {
      // el móvil ya no existe / se dio de baja: fuera de la lista
      await db("pivi_push?endpoint=eq." + q(s.endpoint), { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
      return false;
    }
    if (!r.ok) {
      await marcar({ fails: (s.fails || 0) + 1, last_error: "HTTP " + r.status + " " + (await r.text()).slice(0, 180) });
      return false;
    }
    await marcar({ last_ok: new Date().toISOString(), fails: 0, last_error: null });
    return true;
  } catch (e) {
    await marcar({ fails: (s.fails || 0) + 1, last_error: String((e && e.message) || e).slice(0, 180) });
    return false;
  }
}

async function revisarTodo(soloPerfil) {
  const claves = await clavesVapid();
  const subs = await db("pivi_push?select=endpoint,profile_id,device_id,sub,prefs,fails");
  const perfiles = [...new Set(subs.map((s) => s.profile_id))].filter((p) => !soloPerfil || p === soloPerfil);
  const res = {};
  for (const p of perfiles) res[p.slice(0, 9) + "…"] = await revisarPerfil(p, subs.filter((s) => s.profile_id === p), claves);
  return res;
}

/* ============================================================
   Entrada HTTP
   ============================================================ */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

export async function atender(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    if (req.method === "GET") return json({ clave: (await clavesVapid()).publica });
    let body = {};
    try { body = await req.json(); } catch (_) { /* sin cuerpo */ }
    const perfil = typeof body.perfil === "string" && body.perfil ? body.perfil : null;
    return json({ ok: true, motivo: String(body.motivo || "").slice(0, 20), res: await revisarTodo(perfil) });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String((e && e.message) || e).slice(0, 300) }, 500);
  }
}

if (globalThis.Deno && Deno.serve) Deno.serve(atender);
