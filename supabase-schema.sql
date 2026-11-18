-- ============================================================
-- supabase-schema.sql  —  Tablas para guardar Pivi en la nube
-- ------------------------------------------------------------
-- Cómo usar:
--   1. Abre tu proyecto en https://supabase.com
--   2. Menú lateral: SQL Editor > New query
--   3. Pega TODO este archivo y pulsa "Run"
--      (si avisa de "destructive operations", confirma: solo
--       borra reglas antiguas con el mismo nombre)
--
-- SEGURIDAD: la web manda su profileId en la cabecera
-- "x-pivi-profile" y la base de datos SOLO deja leer/escribir la
-- fila cuyo id coincide. Sin ese id no se puede listar, leer ni
-- tocar nada aunque se conozca la clave pública del proyecto.
-- Borrar filas está prohibido desde la web.
--
-- 🔔 AVISOS (notificaciones push): van aparte, en supabase/avisos.sql
--    (+ la función supabase/functions/pivi-push).
-- ============================================================

-- ---------- 1) ESTADO DEL JUEGO: una fila por perfil ----------
create table if not exists public.pivi_state (
  profile_id  text primary key,
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.pivi_state enable row level security;
revoke delete, truncate on public.pivi_state from anon, authenticated;

-- reglas antiguas (abiertas a todos) fuera
drop policy if exists "pivi anon read"   on public.pivi_state;
drop policy if exists "pivi anon write"  on public.pivi_state;
drop policy if exists "pivi anon update" on public.pivi_state;
drop policy if exists "pivi own read"    on public.pivi_state;
drop policy if exists "pivi own write"   on public.pivi_state;
drop policy if exists "pivi own update"  on public.pivi_state;

create policy "pivi own read"
  on public.pivi_state for select to anon
  using (profile_id = current_setting('request.headers', true)::json ->> 'x-pivi-profile');

create policy "pivi own write"
  on public.pivi_state for insert to anon
  with check (profile_id = current_setting('request.headers', true)::json ->> 'x-pivi-profile');

create policy "pivi own update"
  on public.pivi_state for update to anon
  using      (profile_id = current_setting('request.headers', true)::json ->> 'x-pivi-profile')
  with check (profile_id = current_setting('request.headers', true)::json ->> 'x-pivi-profile');

-- ---------- 2) CONTENIDO EDITABLE (códigos, ruleta, PIN, recompensas) ----------
-- Lo usa el editor "📦 Contenido" del modo Dev para cambiar cosas
-- sin volver a publicar la web. Una fila por perfil (id = profileId).
create table if not exists public.pivi_content (
  id          text primary key,
  content     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.pivi_content enable row level security;
revoke delete, truncate on public.pivi_content from anon, authenticated;

drop policy if exists "content anon read"   on public.pivi_content;
drop policy if exists "content anon write"  on public.pivi_content;
drop policy if exists "content anon update" on public.pivi_content;
drop policy if exists "content own read"    on public.pivi_content;
drop policy if exists "content own write"   on public.pivi_content;
drop policy if exists "content own update"  on public.pivi_content;

create policy "content own read"
  on public.pivi_content for select to anon
  using (id = current_setting('request.headers', true)::json ->> 'x-pivi-profile');

create policy "content own write"
  on public.pivi_content for insert to anon
  with check (id = current_setting('request.headers', true)::json ->> 'x-pivi-profile');

create policy "content own update"
  on public.pivi_content for update to anon
  using      (id = current_setting('request.headers', true)::json ->> 'x-pivi-profile')
  with check (id = current_setting('request.headers', true)::json ->> 'x-pivi-profile');
