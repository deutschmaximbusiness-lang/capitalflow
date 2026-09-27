-- CapitalFlow: Daten loeschen
--
-- Zwei Stufen, weil es zwei verschiedene Beduerfnisse sind:
--
--   1. Ein Import ging schief und soll rueckgaengig gemacht werden.
--      Das ist der haeufige Fall und betrifft nur importierte Zeilen -
--      von Hand eingetragene Trades bleiben stehen.
--   2. Alles weg. Neuanfang, oder jemand will seine Daten los sein
--      (Artikel 17 DSGVO, sobald das Produkt Geld kostet).
--
-- Warum als Funktion in der Datenbank und nicht im Browser: dort waeren
-- es fuenf einzelne Anfragen, von denen die dritte fehlschlagen kann.
-- Dann sind die Trades weg und die Setups noch da, und niemand weiss,
-- in welchem Zustand das Konto ist. Hier laeuft alles in einer
-- Transaktion oder gar nicht.
--
-- In Supabase unter SQL Editor ausfuehren. Laeuft mehrfach durch.

create or replace function public.daten_loeschen(nur_import boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    wer     uuid := auth.uid();
    n_tr    integer := 0;
    n_se    integer := 0;
    n_st    integer := 0;
    n_tx    integer := 0;
begin
    -- Kein Nutzer, keine Loeschung. auth.uid() kommt aus dem Token und
    -- laesst sich vom Aufrufer nicht setzen - deshalb gibt es hier
    -- bewusst KEINEN Parameter fuer die Nutzer-ID. Sonst koennte jeder
    -- die Daten jedes anderen loeschen.
    if wer is null then
        raise exception 'Nicht angemeldet.';
    end if;

    -- Nur die eigene Freischaltung zaehlt. Ein gesperrtes Konto soll
    -- auch nichts loeschen koennen.
    if not coalesce((select activated from public.profiles where id = wer), false) then
        raise exception 'Konto ist nicht freigeschaltet.';
    end if;

    if nur_import then
        delete from public.trades
         where user_id = wer and source = 'import';
        get diagnostics n_tr = row_count;
    else
        delete from public.trades where user_id = wer;
        get diagnostics n_tr = row_count;

        delete from public.setups where user_id = wer;
        get diagnostics n_se = row_count;

        delete from public.strategies where user_id = wer;
        get diagnostics n_st = row_count;

        delete from public.transactions where user_id = wer;
        get diagnostics n_tx = row_count;
    end if;

    -- instruments und products bleiben stehen: die gehoeren allen
    -- gemeinsam. Wer seine Trades loescht, soll nicht die
    -- Produktdatenbank der anderen mitnehmen.

    return jsonb_build_object(
        'trades',        n_tr,
        'setups',        n_se,
        'strategien',    n_st,
        'transaktionen', n_tx,
        'nur_import',    nur_import
    );
end;
$$;

revoke all on function public.daten_loeschen(boolean) from public, anon;
grant execute on function public.daten_loeschen(boolean) to authenticated;

comment on function public.daten_loeschen(boolean) is
    'Loescht die Daten des angemeldeten Nutzers. nur_import=true betrifft '
    'ausschliesslich importierte Trades. Screenshots im Storage muessen '
    'getrennt entfernt werden, die liegen nicht in dieser Datenbank.';

-- ------------------------------------------------------------- Kontrolle
select
    (select count(*) from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'daten_loeschen')  as funktion,
    (select p.prosecdef from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'daten_loeschen')  as security_definer;
