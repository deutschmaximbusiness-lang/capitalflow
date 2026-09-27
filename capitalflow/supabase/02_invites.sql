-- =====================================================================
-- CapitalFlow - Einladungen und Freischaltung (Discord-Login)
--
-- Nach 01_schema.sql ausfuehren. Ersetzt eine fruehere Fassung dieser
-- Datei und laesst sich gefahrlos erneut laufen.
--
-- Warum die Keys nicht mehr in keys.js stehen:
--   Dort liegen die Hashes oeffentlich auf GitHub. Eine Pruefung, die nur
--   im Browser laeuft, umgeht jeder mit einem direkten API-Aufruf.
--   Hier liegen sie hinter RLS, die niemand lesen darf.
--
-- Warum der Key nach dem Login eingeloest wird und nicht davor:
--   Bei Discord-Login tippt niemand etwas ein, bevor das Konto existiert.
--   Der Ablauf ist deshalb: anmelden -> Konto existiert, ist aber gesperrt
--   -> Key eingeben -> freigeschaltet. Ohne Freischaltung verweigert die
--   Datenbank jeden Zugriff auf eigene Daten, nicht nur die Oberflaeche.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Freischaltungs-Kennzeichen am Profil
-- ---------------------------------------------------------------------
alter table public.profiles
    add column if not exists activated boolean not null default false;

alter table public.profiles
    add column if not exists avatar_url text;


-- ---------------------------------------------------------------------
-- 2. Einladungen
-- ---------------------------------------------------------------------
create table if not exists public.invites (
    id         uuid primary key default gen_random_uuid(),
    key_hash   text not null unique,      -- SHA-256 des Keys, hex, klein
    name       text not null,             -- "Marcel" - fuer die Begruessung
    note       text,
    used_by    uuid references auth.users(id) on delete set null,
    used_at    timestamptz,
    revoked    boolean not null default false,
    created_at timestamptz not null default now()
);

alter table public.invites enable row level security;

-- Bewusst keine Policy und kein grant: niemand darf diese Tabelle direkt
-- anfassen. Nur die Funktion unten kommt heran, und die laeuft als
-- security definer mit fest gesetztem search_path.
revoke all on public.invites from anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. Profil beim ersten Discord-Login anlegen
--    Blockiert NICHT mehr - das Konto entsteht, bleibt aber gesperrt.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, name, avatar_url, activated)
    values (
        new.id,
        coalesce(
            nullif(new.raw_user_meta_data ->> 'full_name', ''),
            nullif(new.raw_user_meta_data ->> 'name', ''),
            nullif(new.raw_user_meta_data ->> 'user_name', ''),
            split_part(coalesce(new.email, ''), '@', 1),
            ''
        ),
        new.raw_user_meta_data ->> 'avatar_url',
        false                                  -- gesperrt bis zur Einloesung
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------
-- 4. Key einloesen
--    Wird aus dem Browser aufgerufen: cfDb.rpc('einladung_einloesen',
--    { hash: '<sha256 des keys>' })
--    Der Key selbst verlaesst den Browser nie - nur sein Hash.
-- ---------------------------------------------------------------------
create or replace function public.einladung_einloesen(hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    uid  uuid := auth.uid();
    h    text := lower(coalesce(hash, ''));
    einl public.invites%rowtype;
begin
    if uid is null then
        return jsonb_build_object('ok', false, 'grund', 'nicht angemeldet');
    end if;

    -- Schon freigeschaltet: nichts tun, aber freundlich antworten
    if exists (select 1 from public.profiles
               where id = uid and activated) then
        return jsonb_build_object('ok', true, 'grund', 'bereits freigeschaltet');
    end if;

    if h !~ '^[0-9a-f]{64}$' then
        return jsonb_build_object('ok', false, 'grund', 'ungueltig');
    end if;

    select * into einl from public.invites
    where key_hash = h for update;

    if not found or einl.revoked then
        return jsonb_build_object('ok', false, 'grund', 'ungueltig');
    end if;

    if einl.used_by is not null and einl.used_by <> uid then
        return jsonb_build_object('ok', false, 'grund', 'bereits verwendet');
    end if;

    update public.invites
       set used_by = uid, used_at = coalesce(used_at, now())
     where id = einl.id;

    update public.profiles
       set activated = true, invite_name = einl.name
     where id = uid;

    return jsonb_build_object('ok', true, 'name', einl.name);
end;
$$;

revoke all on function public.einladung_einloesen(text) from public, anon;
grant execute on function public.einladung_einloesen(text) to authenticated;


-- ---------------------------------------------------------------------
-- 5. Ist der angemeldete Nutzer freigeschaltet?
--    stable, damit Postgres das Ergebnis pro Anweisung einmal ermittelt
--    und nicht fuer jede einzelne Zeile.
-- ---------------------------------------------------------------------
create or replace function public.ist_freigeschaltet()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(
        (select activated from public.profiles where id = auth.uid()),
        false)
$$;

grant execute on function public.ist_freigeschaltet() to authenticated;


-- ---------------------------------------------------------------------
-- 6. Policies nachziehen: ohne Freischaltung kein Zugriff
--    Das ist der entscheidende Teil. Ohne ihn koennte jeder mit einem
--    Discord-Konto die App benutzen und der Key waere Dekoration.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
    foreach t in array array['strategies','setups','trades','transactions'] loop
        execute format('drop policy if exists %I_alles on public.%I', t, t);
        execute format(
            'create policy %I_alles on public.%I for all to authenticated '
            || 'using (user_id = (select auth.uid()) and public.ist_freigeschaltet()) '
            || 'with check (user_id = (select auth.uid()) and public.ist_freigeschaltet())',
            t, t);
    end loop;
end $$;

-- Gemeinsame Stammdaten ebenfalls erst nach Freischaltung
drop policy if exists instruments_select on public.instruments;
create policy instruments_select on public.instruments
    for select to authenticated using (public.ist_freigeschaltet());

drop policy if exists products_select on public.products;
create policy products_select on public.products
    for select to authenticated using (public.ist_freigeschaltet());

drop policy if exists instruments_insert on public.instruments;
create policy instruments_insert on public.instruments
    for insert to authenticated
    with check (created_by = (select auth.uid()) and public.ist_freigeschaltet());

drop policy if exists products_insert on public.products;
create policy products_insert on public.products
    for insert to authenticated
    with check (created_by = (select auth.uid()) and public.ist_freigeschaltet());

-- Das eigene Profil darf man immer lesen - sonst weiss die App nach dem
-- Login nicht einmal, dass sie nach dem Key fragen muss
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
    for select to authenticated using (id = (select auth.uid()));

-- Aber activated darf niemand selbst setzen. Deshalb kein update-Recht
-- auf der Spalte: nur einladung_einloesen() aendert sie.
revoke update on public.profiles from authenticated;
grant update (name) on public.profiles to authenticated;


-- ---------------------------------------------------------------------
-- 7. Eure bisherigen Keys uebernehmen
-- ---------------------------------------------------------------------
insert into public.invites (key_hash, name, note) values
    ('dd809c64c663ae01397de23881bca979b4f50f3985bc296dc00b6118c7956044', 'Marcel',  'aus keys.js, 2026-09-20'),
    ('8809ca7ba548a44fdb6c63f52ad7bc640beb90388110e7c1ef44d9a51d6db251', 'Etienne', 'aus keys.js, 2026-09-20'),
    ('40145725e617362ba3e931e2d9c2eec674c374e003ac8c7d9180b112095183fa', 'Matteo',  'aus keys.js, 2026-09-20'),
    ('9f32d1fa366d5c4e05b77ac43d98297fd24ea3b90e45cdbbc7fdda25ce172551', 'Matthis', 'aus keys.js, 2026-09-20'),
    ('990af5f50276579416815ec4daa73a2d217629b263ec9a4166defd376cb53d01', 'Maxim',   'aus keys.js, 2026-09-20')
on conflict (key_hash) do nothing;


-- =====================================================================
-- Verwaltung - im SQL Editor
--
--   Neuen Key aufnehmen (Hash aus der Browser-Console deiner App):
--     insert into public.invites (key_hash, name) values ('<hash>', 'Vorname');
--
--   Zugang entziehen - wirkt sofort, auch bei laufender Sitzung, weil
--   ist_freigeschaltet() bei jeder Abfrage neu prueft:
--     update public.invites set revoked = true where name = 'Vorname';
--     update public.profiles set activated = false
--      where id = (select used_by from public.invites where name = 'Vorname');
--
--   Wer ist drin:
--     select i.name, i.revoked, p.activated, p.name as discord_name
--     from public.invites i
--     left join public.profiles p on p.id = i.used_by
--     order by i.name;
-- =====================================================================

select name,
       case when used_by is null then 'offen' else 'verwendet' end as status,
       revoked
from public.invites
order by name;
