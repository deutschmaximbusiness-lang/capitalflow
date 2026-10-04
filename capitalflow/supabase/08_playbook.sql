-- CapitalFlow: Playbook (M3)
--
-- Die Tabelle strategies gibt es seit 01_schema.sql, ebenso an den
-- Trades strategy_id, rules_followed und r_multiple. Gefehlt hat:
--
-- 1. Grenzen je Strategie (maximaler Hebel, Risiko pro Trade,
--    Notbremse, Ziel, Mindest-CRV, Abstand zu den Earnings). Sie stehen
--    in strategies.settings als JSON - eine Spalte je Wert wuerde bei
--    jeder neuen Grenze eine Migration bedeuten.
-- 2. Der Earnings-Termin am Trade und am Setup. Ohne ihn laesst sich
--    die Regel "eine Woche vor den Earnings raus" nicht pruefen.
-- 3. Das Kapital fuer die Risikorechnung. Liegt in profiles.settings,
--    damit es auf jedem Geraet dasselbe ist.
--
-- In Supabase unter SQL Editor ausfuehren. Laeuft mehrfach durch.
-- Bitte VOR dem Hochladen der neuen App-Version ausfuehren.

-- ------------------------------------------------ 1. Strategien
alter table public.strategies
    add column if not exists settings jsonb not null default '{}'::jsonb;

alter table public.strategies drop constraint if exists strategies_settings_objekt;
alter table public.strategies add constraint strategies_settings_objekt
    check (jsonb_typeof(settings) = 'object');

alter table public.strategies drop constraint if exists strategies_rules_liste;
alter table public.strategies add constraint strategies_rules_liste
    check (jsonb_typeof(rules) = 'array');

alter table public.strategies drop constraint if exists strategies_name_laenge;
alter table public.strategies add constraint strategies_name_laenge
    check (char_length(btrim(name)) between 1 and 80);

comment on column public.strategies.rules is
    'Regeln als Liste: [{"id":"r1","gruppe":"signal","text":"Volumen steigt"}]. '
    'Gruppen: kontext, zone, signal, ausstieg, bonus (bonus = keine Pflicht).';
comment on column public.strategies.settings is
    'Grenzen: hebelMax, risikoMax (%), notbremse (%), zielVon, zielBis (%), '
    'crvMin, earningsTage.';

-- ------------------------------------------------ 2. Earnings-Termin
alter table public.trades  add column if not exists earnings_at date;
alter table public.setups  add column if not exists earnings_at date;
alter table public.setups  add column if not exists rules_followed jsonb;

comment on column public.trades.rules_followed is
    'Abgehakte Regeln der Strategie: {"<regel-id>": true|false}.';

create index if not exists trades_user_strategy_idx
    on public.trades (user_id, strategy_id) where strategy_id is not null;

-- ------------------------------------------------ 3. Einstellungen am Profil
alter table public.profiles
    add column if not exists settings jsonb not null default '{}'::jsonb;

alter table public.profiles drop constraint if exists profiles_settings_objekt;
alter table public.profiles add constraint profiles_settings_objekt
    check (jsonb_typeof(settings) = 'object');

-- 02_invites.sql erlaubt am Profil nur das Aendern des Namens - damit
-- niemand sich selbst freischaltet oder zum Admin macht. Die
-- Einstellungen kommen als zweite Spalte dazu, sonst nichts.
grant update (settings) on public.profiles to authenticated;

-- ------------------------------------------------ 4. Nur eigene Strategien
--
-- Der Fremdschluessel prueft nur, dass es die Strategie gibt - nicht,
-- wem sie gehoert. Wer eine fremde id kennt, koennte seinen Trade daran
-- haengen. Lesen kann er sie wegen RLS trotzdem nicht, aber sauber ist
-- das nicht.
create or replace function public.strategie_gehoert_nutzer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.strategy_id is not null and not exists (
        select 1 from public.strategies s
         where s.id = new.strategy_id and s.user_id = new.user_id
    ) then
        raise exception 'Diese Strategie gehört nicht zu deinem Konto.';
    end if;
    return new;
end;
$$;

drop trigger if exists trades_strategie_pruefen on public.trades;
create trigger trades_strategie_pruefen
    before insert or update of strategy_id on public.trades
    for each row execute function public.strategie_gehoert_nutzer();

drop trigger if exists setups_strategie_pruefen on public.setups;
create trigger setups_strategie_pruefen
    before insert or update of strategy_id on public.setups
    for each row execute function public.strategie_gehoert_nutzer();

notify pgrst, 'reload schema';
