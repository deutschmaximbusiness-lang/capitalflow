-- CapitalFlow: Playbook (M3)
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

alter table public.trades  add column if not exists earnings_at date;
alter table public.setups  add column if not exists earnings_at date;
alter table public.setups  add column if not exists rules_followed jsonb;

comment on column public.trades.rules_followed is
    'Abgehakte Regeln der Strategie: {"<regel-id>": true|false}.';

create index if not exists trades_user_strategy_idx
    on public.trades (user_id, strategy_id) where strategy_id is not null;

alter table public.profiles
    add column if not exists settings jsonb not null default '{}'::jsonb;

alter table public.profiles drop constraint if exists profiles_settings_objekt;
alter table public.profiles add constraint profiles_settings_objekt
    check (jsonb_typeof(settings) = 'object');

grant update (settings) on public.profiles to authenticated;

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