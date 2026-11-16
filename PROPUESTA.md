# Propuesta: guardar los puntos en cualquier dispositivo

## 1. El problema actual

Hoy **todo** se guarda con `localStorage`:

- `points` → los Pivi Puntos
- `redeemedRewards` → recompensas ya canjeadas
- `usedCodes` → códigos usados
- `wheel_spin_monday` / `wheel_spin_wednesday` → candado de la ruleta
- `weekend_played_*` / `weekend_rewarded_*` → candado de los retos del finde

`localStorage` vive **dentro de un navegador concreto de un dispositivo concreto**.
Consecuencias:

1. Si entras desde el móvil ves unos puntos y desde el portátil otros distintos.
2. Borrar caché / cambiar de navegador = se pierde todo.
3. Los "candados" se pueden saltar: un código se puede volver a usar en otro
   dispositivo, y un reto de fin de semana se puede jugar una vez **por
   dispositivo** en lugar de una sola vez en total.

Para que "da igual el dispositivo, los puntos son los mismos" necesitamos un
**almacenamiento compartido en la nube**.

---

## 2. La solución recomendada

Un único registro en la nube con **todo el estado del juego**, identificado por
un `profileId` secreto. Cada dispositivo:

1. Al abrir la web, **descarga** ese registro y lo muestra.
2. Cada vez que ganas/gastas puntos, **sube** el nuevo estado.
3. Cada 30 s (y al volver a la pestaña) vuelve a mirar por si tu pareja /
   tu otro dispositivo ha cambiado algo.

Esto ya está **implementado y conectado** en estos archivos nuevos:

| Archivo | Qué hace |
|---|---|
| `cloud-sync.js` | Toda la lógica de sincronización (offline-first). |
| `cloud-config.js` | Donde pegas tus credenciales. Vacío = modo local. |
| `supabase-schema.sql` | El SQL para crear la tabla en la nube. |

Mientras `cloud-config.js` esté vacío, **la web funciona exactamente igual que
antes** (solo local). En cuanto rellenas los datos, se activa el guardado
compartido sin tocar nada más.

### ¿Por qué Supabase?

Para una web 100 % estática (HTML/CSS/JS sin servidor) es la opción más sencilla
y con plan gratuito de sobra:

- Base de datos real (PostgreSQL) con una API REST automática.
- No hace falta instalar nada ni librerías: `cloud-sync.js` habla con ella con
  `fetch` normal.
- Gratis para este uso (miles de lecturas/escrituras al mes).

**Alternativas válidas** (si prefieres):
- **Firebase Firestore**: muy parecido, también gratis. Habría que cambiar las
  llamadas de `cloud-sync.js` por el SDK de Firebase.
- **Función serverless + KV** (Cloudflare Workers, Netlify/Vercel Functions):
  más control y permite esconder los códigos en el servidor (ver sección 6),
  pero más trabajo de montaje.

---

## 3. Puesta en marcha (15 minutos)

### Paso A — Crear la base de datos
1. Entra en <https://supabase.com> y crea una cuenta gratis.
2. **New project** (apunta la contraseña que te pida; no la necesitarás aquí).
3. Cuando esté listo: menú lateral **SQL Editor → New query**.
4. Pega el contenido de `supabase-schema.sql` y pulsa **Run**.

### Paso B — Copiar las credenciales
En **Project Settings → API** copia:
- **Project URL** → va en `url`
- La clave **`anon` `public`** → va en `anonKey`

### Paso C — Configurar la web
Abre `cloud-config.js` y rellena:

```js
window.PIVI_CLOUD = {
  url: "https://TU-PROYECTO.supabase.co",
  anonKey: "eyJhbGci...tu-clave-anon...",
  profileId: "pivi-2026-inventate-algo-largo-y-secreto",
  table: "pivi_state"
};
```

> El `profileId` funciona como contraseña compartida: ponlo largo y único, y úsalo
> el **mismo** en todos los dispositivos (móvil, portátil, el de tu pareja…).

### Paso D — Publicar la web
Para entrar "desde cualquier dispositivo" la web tiene que estar **online**
(no abierta como `file://`). Opciones gratuitas:
- **GitHub Pages**, **Netlify** o **Vercel**: arrastras la carpeta y listo.

> Nota: aunque solo uses el modo local, abrir la web servida (no como archivo)
> también arregla que `recompensas.json`, `preguntas.json` y `words-es5.txt`
> carguen bien.

¡Y ya está! Verás abajo a la derecha un indicador: **☁️ sincronizado**.

---

## 4. Cómo se comporta (detalles)

- **Offline-first**: la web carga al instante desde el dispositivo y sigue
  funcionando sin internet; cuando vuelve la conexión, sube lo pendiente.
- **Resolución de conflictos**: gana la última escritura (marca de tiempo
  `updated_at`). Para 1–2 personas es más que suficiente.
- **Candados arreglados de paso**: como `usedCodes` y los `weekend_*` ahora
  viajan a la nube, un código usado queda gastado en todos los dispositivos, y
  un reto de fin de semana solo se puede puntuar una vez en total.
- **Indicador de estado**: `☁️ guardando…` / `☁️ sincronizado` / `⚠️ sin conexión`.

---

## 5. Limitaciones conscientes

- Si dos dispositivos cambian puntos **en el mismo instante**, uno de los dos
  cambios puede perderse (gana el último). Improbable en este uso.
- Cualquiera que conozca `url` + `anonKey` + `profileId` puede leer/editar los
  puntos. Por eso el `profileId` debe ser secreto.

---

## 6. Subir el nivel de seguridad (opcional, a futuro)

Si en algún momento quieres más control:

1. **Códigos en el servidor**: hoy los códigos (`GH10-A1B2`, etc.) están en
   `app.js`, así que se pueden leer en el código fuente. Moverlos a una función
   serverless que valide y sume puntos los haría infalsificables.
2. **Login real**: Supabase Auth (email mágico o Google) para que cada persona
   tenga su cuenta en vez de un `profileId` compartido.
3. **Reglas RLS por usuario**: limitar cada fila a su dueño autenticado.

Nada de esto es necesario para empezar; el sistema actual ya cumple
"los mismos puntos en cualquier dispositivo".

---

## 7. Mejoras de código ya aplicadas

- Arreglado un bug en `recompensas.json`: tres mensajes mostraban `/n` literal
  en vez de un salto de línea (`\n`) en el popup (peluche Stitch,
  calentadores de manos y pistola de masaje).
- Añadida toda la capa de sincronización sin romper el comportamiento local.
