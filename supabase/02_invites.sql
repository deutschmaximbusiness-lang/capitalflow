-- =====================================================================
-- CapitalFlow - Einladungen (Early-Access-Keys)
--
-- Nach 01_schema.sql ausfuehren.
--
-- Warum die Keys hierher wandern und nicht in keys.js bleiben:
--
--  1) In keys.js stehen die Hashes oeffentlich auf GitHub. Eine Pruefung,
--     die nur im Browser laeuft, umgeht jeder mit einem direkten
--     signUp-Aufruf gegen die API. Das Gate waere reine Dekoration.
--
--  2) Hier liegen sie hinter RLS, die niemand lesen darf. Der Browser
--     schickt beim Registrieren den Hash des eingegebenen Keys mit; die
--     Datenbank vergleicht. Wer den Key nicht kennt, kommt nicht an den
--     Hash - und die Tabelle sieht er auch nicht.
--
--  3) Neuen Nutzer aufnehmen heisst jetzt: eine Zeile einfuegen.
--     Kein Dateiwechsel, kein Commit, kein Deploy.
-- =====================================================================

create table if not exists public.invites (
    id         uuid primary key default gen_random_uuid(),
    key_hash   text not null unique,          -- SHA-256 des Keys, hex, klein
    name       text not null,                 -- "Marcel" - fuer die Begruessung
    note       text,
    used_by    uuid references auth.users(id) on delete set null,
    used_at    timestamptz,
    revoked    boolean not null default false,
    created_at timestamptz not null default now()
);

alter table public.invites enable row level security;

-- Bewusst KEINE Policy und KEIN grant: weder anon noch authenticated
-- duerfen diese Tabelle anfassen. Nur der Trigger unten kommt heran,
-- und der laeuft als security definer.
revoke all on public.invites from anon, authenticated;


-- ---------------------------------------------------------------------
-- Registrierung nur mit gueltiger, unbenutzter Einladung
--
-- Ersetzt handle_new_user() aus 01_schema.sql. Der Browser uebergibt
-- beim signUp options.data = { invite_hash: "<sha256 des keys>" }.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    h    text := lower(coalesce(new.raw_user_meta_data ->> 'invite_hash', ''));
    einl public.invites%rowtype;
begin
    if h = '' then
        raise exception 'Kein Access Key angegeben'
            using errcode = 'P0001';
    end if;

    select * into einl from public.invites
    where key_hash = h and not revoked
    for update;

    if not found then
        raise exception 'Access Key ungueltig' using errcode = 'P0001';
    end if;

    if einl.used_by is not null then
        raise exception 'Access Key wurde bereits verwendet'
            using errcode = 'P0001';
    end if;

    update public.invites
       set used_by = new.id, used_at = now()
     where id = einl.id;

    insert into public.profiles (id, name, invite_name)
    values (new.id,
            coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), einl.name),
            einl.name)
    on conflict (id) do nothing;

    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------
-- Die bisherigen Keys uebernehmen (Hashes aus keys.js)
-- ---------------------------------------------------------------------
insert into public.invites (key_hash, name, note) values
    ('dd809c64c663ae01397de23881bca979b4f50f3985bc296dc00b6118c7956044', 'Marcel',  'aus keys.js, 2026-09-20'),
    ('8809ca7ba548a44fdb6c63f52ad7bc640beb90388110e7c1ef44d9a51d6db251', 'Etienne', 'aus keys.js, 2026-09-20'),
    ('40145725e617362ba3e931e2d9c2eec674c374e003ac8c7d9180b112095183fa', 'Matteo',  'aus keys.js, 2026-09-20'),
    ('9f32d1fa366d5c4e05b77ac43d98297fd24ea3b90e45cdbbc7fdda25ce172551', 'Matthis', 'aus keys.js, 2026-09-20'),
    ('990af5f50276579416815ec4daa73a2d217629b263ec9a4166defd376cb53d01', 'Maxim',   'aus keys.js, 2026-09-20')
on conflict (key_hash) do nothing;


-- =====================================================================
-- So nimmst du kuenftig jemanden auf
--
--   1. Key erzeugen (in der Browser-Console deiner App):
--        (k => ({ key: k, hash: sha256Hex(k) }))(
--          Array.from(crypto.getRandomValues(new Uint8Array(12)),
--                     b => b.toString(36)).join(String()))
--
--   2. Den Hash hier eintragen, den Key der Person schicken:
--        insert into public.invites (key_hash, name)
--        values ('<hash>', 'Vorname');
--
--   3. Zugang entziehen:
--        update public.invites set revoked = true where name = 'Vorname';
--
--   4. Wer hat sich schon registriert:
--        select name, used_at, revoked from public.invites order by name;
-- =====================================================================

select name,
       case when used_by is null then 'offen' else 'verwendet' end as status,
       revoked
from public.invites
order by name;