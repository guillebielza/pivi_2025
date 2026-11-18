-- ============================================================
-- supabase/avisos.sql  —  🔔 Avisos de Pivi (notificaciones push)
-- ------------------------------------------------------------
-- Se ejecuta UNA vez en el SQL Editor del proyecto "pivi" (se puede
-- repetir sin problema: no borra datos). Antes hay que desplegar la
-- función supabase/functions/pivi-push con «Verify JWT» DESACTIVADO.
--
-- Qué crea:
--   pivi_push         una fila por móvil apuntado (suscripción + qué
--                     avisos quiere). Cada móvil solo toca las de su perfil.
--   pivi_notas        mensajes para mandar (notas del modo Dev y el
--                     «aviso de prueba»).
--   pivi_push_server  PRIVADA (la web no puede leerla): claves VAPID y
--                     lo que ya se ha avisado.
--   disparadores      llaman a la función cuando cambia algo.
--   reloj (pg_cron)   la llama cada 15 min para los recordatorios.
-- ============================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ---------- 1) Móviles apuntados ----------
create table if not exists public.pivi_push (
  endpoint    text primary key,
  profile_id  text not null,
  device_id   text not null,
  sub         jsonb not null,
  prefs       jsonb not null default '{}'::jsonb,
  ua          text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  last_ok     timestamptz,
  fails       int not null default 0,
  last_error  text
);
alter table public.pivi_push enable row level security;
revoke truncate on public.pivi_push from anon, authenticated;

drop policy if exists "push own read"   on public.pivi_push;
drop policy if exists "push own write"  on public.pivi_push;
drop policy if exists "push own update" on public.pivi_push;
drop policy if exists "push own delete" on public.pivi_push;
create policy "push own read" on public.pivi_push for select to anon
  using (profile_id = current_setting('request.headers', true)::json ->> 'x-pivi-profile');
create policy "push own write" on public.pivi_push for insert to anon
  with check (profile_id = current_setting('request.headers', true)::json ->> 'x-pivi-profile');
create policy "push own update" on public.pivi_push for update to anon
  using      (profile_id = current_setting('request.headers', true)::json ->> 'x-pivi-profile')
  with check (profile_id = current_setting('request.headers', true)::json ->> 'x-pivi-profile');
-- darse de baja en un móvil borra su fila (solo las del propio perfil)
create policy "push own delete" on public.pivi_push for delete to anon
  using (profile_id = current_setting('request.headers', true)::json ->> 'x-pivi-profile');

-- ---------- 2) Notas ----------
create table if not exists public.pivi_notas (
  id          bigint generated always as identity primary key,
  profile_id  text not null,
  from_device text,
  to_device   text,              -- vacío = a todos menos a quien la manda
  titulo      text check (titulo is null or char_length(titulo) <= 60),
  texto       text not null check (char_length(texto) between 1 and 300),
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  resultado   text
);
alter table public.pivi_notas enable row level security;
revoke update, delete, truncate on public.pivi_notas from anon, authenticated;

drop policy if exists "notas own read"  on public.pivi_notas;
drop policy if exists "notas own write" on public.pivi_notas;
create policy "notas own read" on public.pivi_notas for select to anon
  using (profile_id = current_setting('request.headers', true)::json ->> 'x-pivi-profile');
create policy "notas own write" on public.pivi_notas for insert to anon
  with check (profile_id = current_setting('request.headers', true)::json ->> 'x-pivi-profile');

-- ---------- 3) Privada del servidor (sin reglas = nadie desde la web) ----------
create table if not exists public.pivi_push_server (
  id          text primary key,   -- 'vapid' o 'meta:<perfil>'
  data        jsonb not null default '{}'::jsonb,
  lock_until  timestamptz,
  updated_at  timestamptz not null default now()
);
alter table public.pivi_push_server enable row level security;
revoke all on public.pivi_push_server from anon, authenticated;

-- ---------- 4) Disparadores: «ha cambiado algo, revisa» ----------
-- La función no se fía del aviso: lee la base de datos y decide.
-- Si la llamada falla, NUNCA impide guardar (excepción tragada).
create or replace function public.pivi_avisos_ping()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform net.http_post(
    url := 'https://ragsrhvaepisvigthmyu.supabase.co/functions/v1/pivi-push',
    body := jsonb_build_object(
      'motivo', tg_table_name,
      'perfil', coalesce(to_jsonb(new) ->> 'profile_id', to_jsonb(new) ->> 'id')),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 25000
  );
  return null;
exception when others then
  return null;
end;
$$;

drop trigger if exists pivi_avisos_estado_ins on public.pivi_state;
drop trigger if exists pivi_avisos_estado_upd on public.pivi_state;
create trigger pivi_avisos_estado_ins after insert on public.pivi_state
  for each row execute function public.pivi_avisos_ping();
create trigger pivi_avisos_estado_upd after update on public.pivi_state
  for each row when (old.state is distinct from new.state)
  execute function public.pivi_avisos_ping();

drop trigger if exists pivi_avisos_catalogo_ins on public.pivi_content;
drop trigger if exists pivi_avisos_catalogo_upd on public.pivi_content;
create trigger pivi_avisos_catalogo_ins after insert on public.pivi_content
  for each row execute function public.pivi_avisos_ping();
create trigger pivi_avisos_catalogo_upd after update on public.pivi_content
  for each row when (old.content is distinct from new.content)
  execute function public.pivi_avisos_ping();

drop trigger if exists pivi_avisos_nota on public.pivi_notas;
create trigger pivi_avisos_nota after insert on public.pivi_notas
  for each row execute function public.pivi_avisos_ping();

-- un móvil nuevo: la función toma nota de lo que hay (para no avisar del pasado)
drop trigger if exists pivi_avisos_movil on public.pivi_push;
create trigger pivi_avisos_movil after insert on public.pivi_push
  for each row execute function public.pivi_avisos_ping();

-- ---------- 5) Reloj: recordatorios (cada 15 min; la función mira la hora de Madrid) ----------
select cron.schedule(
  'pivi-avisos-reloj',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://ragsrhvaepisvigthmyu.supabase.co/functions/v1/pivi-push',
    body := '{"motivo": "reloj"}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 25000
  );
  $cron$
);

-- Para pararlo todo:  select cron.unschedule('pivi-avisos-reloj');
--                     drop trigger … (los de arriba)
-- Para ver cómo va:   select * from public.pivi_push;           (móviles y último error)
--                     select * from public.pivi_notas order by id desc;
--                     select * from net._http_response order by created desc limit 20;
