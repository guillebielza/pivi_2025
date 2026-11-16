/* ============================================================
   cloud-config.js  —  Configuración del guardado en la nube
   ------------------------------------------------------------
   Mientras los campos estén VACÍOS, la web funciona en modo local
   (los puntos se guardan solo en ese dispositivo, como hasta ahora).

   Para que los puntos se guarden y se compartan en CUALQUIER
   dispositivo, rellena los 3 valores siguiendo PROPUESTA.md:

     1. Crea un proyecto gratis en https://supabase.com
     2. Ejecuta el SQL de  supabase-schema.sql  (Project > SQL Editor)
     3. Copia aquí la "Project URL" y la clave PÚBLICA: la
        "publishable" (sb_publishable_…) o la antigua "anon public"
        (eyJ…). ¡Nunca la "secret" ni la "service_role"!
     4. profileId: id largo y aleatorio, el MISMO en todos los
        dispositivos. La base de datos solo deja leer/escribir la
        fila de este id (ver supabase-schema.sql).

   Ejemplo ya configurado:
     url:       "https://abcdxyz.supabase.co"
     anonKey:   "sb_publishable_........"
     profileId: "pivi-2026-9f3a7c1b6e2d"   // invéntate uno único

   NOTA (nov-2026): proyecto Supabase "pivi". El antiguo
   ("reto-2026") está pausado. Si Supabase pausa este por falta de
   uso, la tarea .github/workflows/supabase-keepalive.yml lo evita.
   ============================================================ */
window.PIVI_CLOUD = {
  url: "https://ragsrhvaepisvigthmyu.supabase.co",        // URL del proyecto Supabase ("pivi")
  anonKey: "sb_publishable_IT3VI3E0VdJvOayOBm7m4Q_bqaL7Vuf",    // clave pública (publishable)
  profileId: "pivi-cphqAAwU3sXJFjTUuTlnLTpV",  // identificador secreto compartido entre dispositivos
  table: "pivi_state"
};
