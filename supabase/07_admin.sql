-- CapitalFlow: Zugangsschluessel aus der App heraus verwalten
--
-- Bisher war das Aufnehmen einer Person ein Deploy: Schluessel im
-- Admin-Panel erzeugen, Zeile nach js/keys.js kopieren, committen,
-- pushen, warten. Fuenf Schritte, bei denen der dritte gern vergessen
-- wird - und dann sitzt jemand vor einem Schluessel, der nicht geht.
--
-- Die Schluessel liegen laengst hier in invites (02_invites.sql).
-- Gefehlt hat nur ein Weg, sie aus der Oberflaeche heraus anzulegen.
-- Den bauen diese vier Funktionen.
--
-- Der Schluessel selbst kommt nie hier an. Er wird im Browser erzeugt,
-- dort gehasht, und nur der Hash geht ueber die Leitung. Wer diese
-- Datenbank vollstaendig liest, kann damit niemanden einloggen.
--
-- In Supabase unter SQL Editor ausfuehren. Laeuft mehrfach durch.

-- ------------------------------------------------------ 1. Admin-Kennzeichen
--
-- Absichtlich eine Spalte am Profil und kein Schluessel im Quelltext.
-- Der bisherige Admin-Zugang war ein SHA-256-Hash in js/keys.js, geprueft
-- allein im Browser: oeffentlich lesbar und mit veraenderten
-- Javascript-Dateien zu umgehen. Was hier steht, sieht der Browser nie
-- und kann er nicht setzen.
alter table public.profiles
    add column if not exists is_admin boolean not null default false;

comment on column public.profiles.is_admin is
    'Darf Einladungen anlegen und sperren. Wird ausschliesslich von Hand '
    'im SQL Editor gesetzt - es gibt bewusst keine Funktion dafuer.';

-- Den bisherigen Inhaber des Maxim-Schluessels zum Admin machen. Hat er
-- noch nicht eingeloest, passiert nichts - dann greift die Zeile ganz
-- unten in diesem Skript.
update public.profiles
   set is_admin = true
 where id in (select used_by from public.invites
               where name = 'Maxim' and used_by is not null);


create or replace function public.ist_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce((select is_admin from public.profiles
                      where id = auth.uid()), false)
$$;

grant execute on function public.ist_admin() to authenticated;


-- ---------------------------------------------------- 2. Einladung anlegen
--
-- Bekommt nur den Hash. Der Name dient der Begruessung und dazu, dass in
-- der Liste nicht nur Hexadezimalzahlen stehen.
create or replace function public.einladung_anlegen(hash text, name text,
                                                    note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    h    text := lower(trim(coalesce(hash, '')));
    n    text := trim(coalesce(name, ''));
    neu  uuid;
begin
    if not public.ist_admin() then
        raise exception 'Kein Adminrecht.';
    end if;

    -- Ein Hash, der keiner ist, wuerde als toter Eintrag in der Liste
    -- stehen und sich nie einloesen lassen. Lieber hier scheitern.
    if h !~ '^[0-9a-f]{64}$' then
        raise exception 'Das ist kein SHA-256-Hash.';
    end if;

    if n = '' then
        raise exception 'Ohne Namen wird die Liste unbrauchbar.';
    end if;

    -- Zwei Nutzer mit demselben Hash hiesse: derselbe Schluessel. Das
    -- kann bei 128 Bit Zufall nicht passieren - wohl aber, wenn jemand
    -- zweimal auf den Knopf drueckt und der erste Aufruf noch laeuft.
    if exists (select 1 from public.invites where key_hash = h) then
        raise exception 'Dieser Schluessel ist schon vergeben.';
    end if;

    insert into public.invites (key_hash, name, note)
    values (h, n, note)
    returning id into neu;

    return jsonb_build_object('ok', true, 'id', neu, 'name', n);
end;
$$;

revoke all on function public.einladung_anlegen(text, text, text) from public, anon;
grant execute on function public.einladung_anlegen(text, text, text) to authenticated;


-- ------------------------------------------------------ 3. Liste anzeigen
--
-- Gibt NICHT den Hash zurueck. Aus ihm laesst sich der Schluessel zwar
-- nicht zurueckrechnen, aber er gehoert trotzdem nicht in eine
-- Oberflaeche: wer ihn hat, kann offline durchprobieren, und die
-- Schluessel haben ein festes Format.
create or replace function public.einladungen_liste()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    ergebnis jsonb;
begin
    if not public.ist_admin() then
        raise exception 'Kein Adminrecht.';
    end if;

    select coalesce(jsonb_agg(z order by z->>'name'), '[]'::jsonb)
      into ergebnis
      from (
        select jsonb_build_object(
            'id',       i.id,
            'name',     i.name,
            'note',     i.note,
            'revoked',  i.revoked,
            'used',     i.used_by is not null,
            'used_at',  i.used_at,
            'created',  i.created_at,
            -- Wie die Person bei Discord heisst. Weicht das vom Namen auf
            -- der Einladung ab, hat jemand den Schluessel weitergegeben.
            'konto',    p.name
        ) as z
        from public.invites i
        left join public.profiles p on p.id = i.used_by
      ) t;

    return ergebnis;
end;
$$;

revoke all on function public.einladungen_liste() from public, anon;
grant execute on function public.einladungen_liste() to authenticated;


-- --------------------------------------------- 4. Sperren und wieder oeffnen
--
-- Sperren muss BEIDES treffen: die Einladung und die Freischaltung am
-- Profil. Nur die Einladung zu sperren wuerde nichts bewirken - die wird
-- nach dem Einloesen nie wieder gelesen, und die Person bliebe drin.
create or replace function public.einladung_sperren(id uuid, sperren boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    einl public.invites%rowtype;
begin
    if not public.ist_admin() then
        raise exception 'Kein Adminrecht.';
    end if;

    select * into einl from public.invites where invites.id = einladung_sperren.id;
    if not found then
        raise exception 'Diese Einladung gibt es nicht.';
    end if;

    -- Sich selbst auszusperren ist ein Weg ohne Rueckweg: danach gibt es
    -- keinen Admin mehr, der die Sperre aufheben koennte, und es bliebe
    -- nur der SQL Editor.
    if sperren and einl.used_by = auth.uid() then
        raise exception 'Du kannst dich nicht selbst sperren.';
    end if;

    update public.invites set revoked = sperren where invites.id = einl.id;

    if einl.used_by is not null then
        update public.profiles set activated = not sperren
         where profiles.id = einl.used_by;
    end if;

    return jsonb_build_object('ok', true, 'gesperrt', sperren);
end;
$$;

revoke all on function public.einladung_sperren(uuid, boolean) from public, anon;
grant execute on function public.einladung_sperren(uuid, boolean) to authenticated;


-- --------------------------------------------------- Profil: is_admin lesen
--
-- Die App muss nach dem Login wissen, ob sie den Admin-Bereich zeigen
-- soll. Die Policy auf profiles erlaubt schon das Lesen der eigenen
-- Zeile; hier steht nur, dass das so bleiben soll.
--
-- Gesetzt wird das Kennzeichen nie aus der App: revoke update von
-- 02_invites.sql laesst ohnehin nur noch name zu.


-- ---------------------------------------------------- Schema neu laden
notify pgrst, 'reload schema';


-- ------------------------------------------------------------- Kontrolle
select
    (select count(*) from public.profiles where is_admin)        as admins,
    (select count(*) from public.invites where not revoked)      as offen,
    (select count(*) from public.invites where used_by is not null) as eingeloest;

-- =====================================================================
-- FALLS "admins" OBEN 0 IST
--
-- Dann hat noch niemand den Maxim-Schluessel eingeloest, oder das Konto
-- haengt an einer anderen Einladung. Einmal von Hand nachhelfen - erst
-- schauen, wer da ist:
--
--   select p.id, p.name, i.name as einladung
--     from public.profiles p
--     left join public.invites i on i.used_by = p.id;
--
-- Dann die eigene Zeile freischalten:
--
--   update public.profiles set is_admin = true where id = '<deine uuid>';
--
-- Danach in der App neu laden - der Admin-Bereich erscheint in der
-- Seitenleiste.
-- =====================================================================