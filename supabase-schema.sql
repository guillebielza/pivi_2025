-- ============================================================
-- supabase-schema.sql  —  Tabla para guardar los puntos en la nube
-- ------------------------------------------------------------
-- Cómo usar:
--   1. Abre tu proyecto en https://supabase.com
--   2. Menú lateral: SQL Editor > New query
--   3. Pega TODO este archivo y pulsa "Run"
-- ============================================================

-- Tabla: un único registro por "perfil" (profileId).
-- 'state' guarda todo el estado del juego como JSON.
create table if not exists public.pivi_state (
  profile_id  text primary key,
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- Activamos Row Level Security...
alter table public.pivi_state enable row level security;

-- ...y permitimos acceso con la clave anónima (anon).
-- La privacidad la da el profileId secreto del cloud-config.js:
-- sin conocerlo no puedes leer ni escribir la fila de otra persona...
-- salvo que adivines el id. Para algo más serio, ver PROPUESTA.md
-- (sección "Subir el nivel de seguridad").
drop policy if exists "pivi anon read"   on public.pivi_state;
drop policy if exists "pivi anon write"  on public.pivi_state;
drop policy if exists "pivi anon update" on public.pivi_state;

create policy "pivi anon read"
  on public.pivi_state for select
  to anon using (true);

create policy "pivi anon write"
  on public.pivi_state for insert
  to anon with check (true);

create policy "pivi anon update"
  on public.pivi_state for update
  to anon using (true) with check (true);

-- ============================================================
-- Tabla de CONTENIDO editable (códigos, ruleta, PIN, recompensas)
-- Permite editar esas cosas "en caliente" desde el editor del modo
-- Dev, sin volver a publicar la web. Una fila por perfil (id = profileId).
-- ============================================================
create table if not exists public.pivi_content (
  id          text primary key,
  content     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.pivi_content enable row level security;

drop policy if exists "content anon read"   on public.pivi_content;
drop policy if exists "content anon write"  on public.pivi_content;
drop policy if exists "content anon update" on public.pivi_content;

create policy "content anon read"
  on public.pivi_content for select
  to anon using (true);

create policy "content anon write"
  on public.pivi_content for insert
  to anon with check (true);

create policy "content anon update"
  on public.pivi_content for update
  to anon using (true) with check (true);
