-- =====================================================================
-- CapitalFlow - Datenbankschema v1
-- Projekt: vraymusbcgsoksnsfwiv
--
-- Einmal komplett im Supabase SQL Editor ausfuehren.
-- Laeuft mehrfach durch, ohne kaputtzugehen (drop if exists / if not exists).
--
-- Zwei Entscheidungen stecken hier drin, die spaeter teuer zu aendern sind:
--
--  1) Basiswert und Produkt sind getrennt. Ein Knockout auf NVDA hat eine
--     eigene WKN, einen eigenen Kurs und einen eigenen Hebel - aber die
--     Statistik muss trotzdem "alle meine NVDA-Trades" beantworten koennen.
--
--  2) Offene und geschlossene Trades liegen in EINER Tabelle mit einer
--     Statusspalte. In der alten App lagen sie getrennt, weshalb
--     geschlossene Positionen in keiner einzigen Auswertung auftauchten.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Profile - haengt an Supabase Auth
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
    id          uuid primary key references auth.users(id) on delete cascade,
    name        text not null default '',
    invite_name text,                       -- Name aus dem Early-Access-Key
    created_at  timestamptz not null default now()
);

-- Beim Registrieren automatisch ein Profil anlegen, sonst muesste das
-- Frontend das nachholen und koennte es vergessen
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, name, invite_name)
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'name', ''),
        new.raw_user_meta_data ->> 'invite_name'
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
-- 2. Instrumente - der Basiswert, z. B. NVDA
--    Gemeinsam fuer alle Nutzer: jeder darf lesen und neue anlegen,
--    aber niemand darf fremde Eintraege veraendern oder loeschen.
-- ---------------------------------------------------------------------
create table if not exists public.instruments (
    id         uuid primary key default gen_random_uuid(),
    symbol     text not null,
    name       text,
    isin       text,
    kind       text not null default 'aktie'
               check (kind in ('aktie','index','rohstoff','waehrung','krypto')),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);

-- Symbole immer gross schreiben, sonst liegen NVDA und nvda getrennt
create unique index if not exists instruments_symbol_key
    on public.instruments (upper(symbol));


-- ---------------------------------------------------------------------
-- 3. Produkte - das, was tatsaechlich gehandelt wird
--    Bei einem Direktkauf ist das die Aktie selbst, bei Trade Republic
--    meist ein Knockout oder Faktor-Zertifikat mit eigener WKN.
-- ---------------------------------------------------------------------
create table if not exists public.products (
    id            uuid primary key default gen_random_uuid(),
    instrument_id uuid not null references public.instruments(id) on delete cascade,
    kind          text not null default 'aktie'
                  check (kind in ('aktie','knockout','faktor','optionsschein')),
    wkn           text,
    isin          text,
    issuer        text,                     -- HSBC, Societe Generale, ...
    direction     text check (direction in ('long','short')),
    strike        numeric,                  -- Basispreis
    ratio         numeric,                  -- Bezugsverhaeltnis
    ko_barrier    numeric,                  -- Knock-out-Schwelle
    factor        numeric,                  -- nur bei Faktor-Zertifikaten
    created_by    uuid references auth.users(id) on delete set null,
    created_at    timestamptz not null default now(),

    -- Ein Knockout ohne Basispreis und Bezugsverhaeltnis laesst sich nicht
    -- rechnen - lieber beim Anlegen scheitern als spaeter falsche Hebel zeigen
    constraint products_zertifikat_vollstaendig check (
        kind not in ('knockout','faktor','optionsschein')
        or (strike is not null and ratio is not null and direction is not null)
    ),
    constraint products_faktor_hat_faktor check (
        kind <> 'faktor' or factor is not null
    )
);

create unique index if not exists products_wkn_key
    on public.products (upper(wkn)) where wkn is not null;
create index if not exists products_instrument_idx
    on public.products (instrument_id);


-- ---------------------------------------------------------------------
-- 4. Strategien - das Playbook
-- ---------------------------------------------------------------------
create table if not exists public.strategies (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users(id) on delete cascade,
    name        text not null,
    description text,
    -- Regeln als Liste von Texten: ["Volumen ueber Schnitt", "Kein Earnings-Termin"]
    rules       jsonb not null default '[]'::jsonb,
    archived    boolean not null default false,
    created_at  timestamptz not null default now(),
    unique (user_id, name)
);


-- ---------------------------------------------------------------------
-- 5. Setups - geplante Trades
-- ---------------------------------------------------------------------
create table if not exists public.setups (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users(id) on delete cascade,
    instrument_id   uuid references public.instruments(id) on delete set null,
    product_id      uuid references public.products(id) on delete set null,
    strategy_id     uuid references public.strategies(id) on delete set null,
    direction       text not null check (direction in ('long','short')),
    entry_from      numeric,
    entry_to        numeric,
    stop_loss       numeric,
    target          numeric,
    thesis          text,
    screenshot_path text,
    status          text not null default 'beobachten'
                    check (status in ('beobachten','bereit','eingestiegen','verworfen')),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists setups_user_status_idx
    on public.setups (user_id, status);


-- ---------------------------------------------------------------------
-- 6. Trades - offen UND geschlossen in einer Tabelle
--
--    status = 'offen'        -> Portfolio Analyse
--    status = 'geschlossen'  -> Journal, Analytics, Kalender
--
--    Dadurch kann keine Auswertung mehr die Haelfte der Daten uebersehen.
-- ---------------------------------------------------------------------
create table if not exists public.trades (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users(id) on delete cascade,
    instrument_id   uuid references public.instruments(id) on delete set null,
    product_id      uuid references public.products(id) on delete set null,
    strategy_id     uuid references public.strategies(id) on delete set null,
    setup_id        uuid references public.setups(id) on delete set null,

    status          text not null default 'offen'
                    check (status in ('offen','geschlossen')),
    direction       text not null check (direction in ('long','short')),

    entry_price     numeric not null check (entry_price > 0),
    stop_loss       numeric,
    target          numeric,
    quantity        numeric,          -- Stueck
    position_size   numeric,          -- eingesetztes Kapital in Euro
    leverage        numeric default 1,

    exit_price      numeric,
    fees            numeric not null default 0,

    -- Kennzahlen: werden beim Speichern berechnet, damit Auswertungen
    -- nicht bei jedem Aufruf ueber alle Zeilen rechnen muessen
    pnl             numeric,
    pnl_percent     numeric,
    risk_amount     numeric,
    r_multiple      numeric,

    thesis          text,
    exit_reason     text,
    notes           text,
    error_type      text,
    -- Welche Regeln der Strategie wurden eingehalten: {"0": true, "1": false}
    rules_followed  jsonb,
    screenshot_path text,
    source          text not null default 'manuell'
                    check (source in ('manuell','import')),
    -- Importierte Trades sind unvollstaendig, bis der Nutzer Stop,
    -- These und Strategie ergaenzt hat
    incomplete      boolean not null default false,

    opened_at       timestamptz not null default now(),
    closed_at       timestamptz,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    constraint trades_geschlossen_vollstaendig check (
        status = 'offen'
        or (exit_price is not null and closed_at is not null)
    ),
    constraint trades_offen_ohne_exit check (
        status = 'geschlossen' or (exit_price is null and closed_at is null)
    )
);

create index if not exists trades_user_status_idx
    on public.trades (user_id, status);
-- Fuer Equity-Kurve, Kalender und Drawdown: geschlossene Trades nach Datum
create index if not exists trades_user_closed_idx
    on public.trades (user_id, closed_at desc) where status = 'geschlossen';
create index if not exists trades_user_strategy_idx
    on public.trades (user_id, strategy_id);


-- ---------------------------------------------------------------------
-- 7. Transaktionen - Ein- und Auszahlungen
-- ---------------------------------------------------------------------
create table if not exists public.transactions (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users(id) on delete cascade,
    kind       text not null check (kind in ('einzahlung','auszahlung')),
    amount     numeric not null check (amount > 0),
    booked_at  date not null default current_date,
    note       text,
    created_at timestamptz not null default now()
);

create index if not exists transactions_user_date_idx
    on public.transactions (user_id, booked_at desc);


-- ---------------------------------------------------------------------
-- 8. updated_at automatisch mitfuehren
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trades_touch on public.trades;
create trigger trades_touch before update on public.trades
    for each row execute function public.touch_updated_at();

drop trigger if exists setups_touch on public.setups;
create trigger setups_touch before update on public.setups
    for each row execute function public.touch_updated_at();


-- =====================================================================
-- RECHTE
--
-- Supabase vergibt diese Rechte normalerweise automatisch mit. Explizit
-- hingeschrieben, weil die Alternative eine App ist, die kommentarlos
-- "permission denied" sagt und man eine Stunde im Frontend sucht.
--
-- anon bekommt bewusst nichts: ohne Anmeldung gibt es hier nichts zu holen.
-- =====================================================================

grant usage on schema public to authenticated;

grant select, insert, update, delete
    on public.profiles, public.strategies, public.setups,
       public.trades, public.transactions
    to authenticated;

-- Instrumente und Produkte sind gemeinsamer Bestand: anlegen und die
-- eigenen pflegen ja, loeschen nein - sonst reisst einer Zeilen weg,
-- an denen fremde Trades haengen.
grant select, insert, update on public.instruments, public.products
    to authenticated;

revoke all on all tables in schema public from anon;


-- =====================================================================
-- ROW LEVEL SECURITY
--
-- Ohne das darf der anon key aus dem Browser ALLES lesen. Mit dem hier
-- kann die Datenbank selbst keine fremden Zeilen herausgeben, egal was
-- das Frontend fragt. Das ersetzt den provisorischen localStorage-Shim.
-- =====================================================================

alter table public.profiles     enable row level security;
alter table public.instruments  enable row level security;
alter table public.products     enable row level security;
alter table public.strategies   enable row level security;
alter table public.setups       enable row level security;
alter table public.trades       enable row level security;
alter table public.transactions enable row level security;

-- --- Profile: nur das eigene
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
    for select to authenticated using (id = (select auth.uid()));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
    for update to authenticated
    using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- --- Instrumente und Produkte: gemeinsamer Bestand.
--     Lesen duerfen alle Angemeldeten, anlegen auch - aber aendern und
--     loeschen nur die eigenen Eintraege. So waechst die Produktdatenbank
--     mit jedem Import, ohne dass jemand fremde Daten kaputtmachen kann.
drop policy if exists instruments_select on public.instruments;
create policy instruments_select on public.instruments
    for select to authenticated using (true);

drop policy if exists instruments_insert on public.instruments;
create policy instruments_insert on public.instruments
    for insert to authenticated
    with check (created_by = (select auth.uid()));

drop policy if exists instruments_update on public.instruments;
create policy instruments_update on public.instruments
    for update to authenticated
    using (created_by = (select auth.uid()))
    with check (created_by = (select auth.uid()));

drop policy if exists products_select on public.products;
create policy products_select on public.products
    for select to authenticated using (true);

drop policy if exists products_insert on public.products;
create policy products_insert on public.products
    for insert to authenticated
    with check (created_by = (select auth.uid()));

drop policy if exists products_update on public.products;
create policy products_update on public.products
    for update to authenticated
    using (created_by = (select auth.uid()))
    with check (created_by = (select auth.uid()));

-- --- Eigene Daten: volle Rechte, aber ausschliesslich auf eigenen Zeilen
do $$
declare t text;
begin
    foreach t in array array['strategies','setups','trades','transactions'] loop
        execute format('drop policy if exists %I_alles on public.%I', t, t);
        execute format(
            'create policy %I_alles on public.%I for all to authenticated '
            || 'using (user_id = (select auth.uid())) '
            || 'with check (user_id = (select auth.uid()))', t, t);
    end loop;
end $$;


-- =====================================================================
-- STORAGE: Screenshots
-- Bisher lagen die als Base64 im localStorage und liefen gegen das
-- 5-MB-Limit. Jeder Nutzer bekommt einen eigenen Ordner nach seiner
-- User-ID; die Policies sorgen dafuer, dass niemand fremde Ordner sieht.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', false)
on conflict (id) do nothing;

do $$
declare p text;
begin
    foreach p in array array['screens_select','screens_insert','screens_update','screens_delete'] loop
        execute format('drop policy if exists %I on storage.objects', p);
    end loop;
end $$;

create policy screens_select on storage.objects
    for select to authenticated
    using (bucket_id = 'screenshots'
           and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy screens_insert on storage.objects
    for insert to authenticated
    with check (bucket_id = 'screenshots'
                and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy screens_update on storage.objects
    for update to authenticated
    using (bucket_id = 'screenshots'
           and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy screens_delete on storage.objects
    for delete to authenticated
    using (bucket_id = 'screenshots'
           and (storage.foldername(name))[1] = (select auth.uid())::text);


-- =====================================================================
-- Kontrolle: muss 7 Tabellen zeigen, alle mit rowsecurity = true
-- =====================================================================
select tablename, rowsecurity as rls_aktiv
from pg_tables
where schemaname = 'public'
  and tablename in ('profiles','instruments','products','strategies',
                    'setups','trades','transactions')
order by tablename;