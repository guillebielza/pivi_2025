/* ============================================================
   cloud-config.js  —  Configuración del guardado en la nube
   ------------------------------------------------------------
   Mientras los campos estén VACÍOS, la web funciona en modo local
   (los puntos se guardan solo en ese dispositivo, como hasta ahora).

   Para que los puntos se guarden y se compartan en CUALQUIER
   dispositivo, rellena los 3 valores siguiendo PROPUESTA.md:

     1. Crea un proyecto gratis en https://supabase.com
     2. Ejecuta el SQL de  supabase-schema.sql  (Project > SQL Editor)
     3. Copia aquí la URL y la clave "anon public"
        (Project Settings > API)
     4. Inventa un profileId largo y secreto (actúa como contraseña):
        cualquiera con estos 3 datos puede ver/editar los puntos.

   Ejemplo ya configurado:
     url:       "https://abcdxyz.supabase.co"
     anonKey:   "eyJhbGciOiJIUzI1NiIsIn........"
     profileId: "pivi-2026-9f3a7c1b6e2d"   // invéntate uno único

   NOTA (nov-2026): el proyecto Supabase anterior ya no existe, así
   que la nube está DESACTIVADA (url y anonKey vacíos) hasta crear
   uno nuevo. Mientras tanto la web funciona en modo local.
   ============================================================ */
window.PIVI_CLOUD = {
  url: "",        // URL del proyecto Supabase
  anonKey: "",    // clave anon public
  profileId: "Pivi_12345$%&",  // identificador secreto compartido entre dispositivos
  table: "pivi_state"
};
