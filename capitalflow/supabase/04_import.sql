-- CapitalFlow M4: Trade-Republic-Import
--
-- Ein Transaktionsexport ueberschneidet sich fast immer mit dem
-- vorigen: wer im Oktober "letzte 6 Monate" exportiert, hat den
-- September doppelt. Ohne Schutz waechst das Journal bei jedem Import
-- um dieselben Trades, und die Statistik ist hin.
--
-- Deshalb bekommt jeder importierte Trade einen Schluessel aus den
-- Transaktions-IDs, aus denen er gebaut wurde. Trade Republic vergibt
-- die pro Buchung und aendert sie nicht.
--
-- In Supabase unter SQL Editor ausfuehren. Laeuft mehrfach durch.

alter table public.trades
    add column if not exists import_key text;

comment on column public.trades.import_key is
    'Schluessel aus den TR-Transaktions-IDs; verhindert doppelte Importe';

-- Pro Nutzer eindeutig, nicht global: zwei Leute koennen denselben
-- Trade gehandelt haben, das sind trotzdem zwei Trades.
create unique index if not exists trades_import_key
    on public.trades (user_id, import_key)
    where import_key is not null;

-- Gebuehren stehen schon als Spalte im Schema und werden vom Import
-- gefuellt. Damit sie in der Auswertung nicht untergehen, hier eine
-- Sicht darauf: was der "kostenlose" Broker tatsaechlich kostet.
create or replace view public.auswertung_gebuehren as
select
    t.user_id,
    date_trunc('month', t.closed_at)::date         as monat,
    count(*)                                       as trades,
    round(sum(t.fees), 2)                          as gebuehren,
    round(sum(t.pnl), 2)                           as pnl_netto,
    round(sum(t.pnl) + sum(t.fees), 2)             as pnl_vor_gebuehren,
    -- Anteil der Gebuehren am eingesetzten Kapital. Bei kleinen
    -- Positionen ist das die Zahl, die weh tut.
    round(100.0 * sum(t.fees) / nullif(sum(t.position_size), 0), 2)
                                                   as prozent_vom_einsatz
from public.trades t
where t.status = 'geschlossen' and t.closed_at is not null
group by 1, 2
order by 2 desc;

alter view public.auswertung_gebuehren set (security_invoker = on);
grant select on public.auswertung_gebuehren to authenticated;

-- ------------------------------------------------------------- Kontrolle
select
    (select count(*) from information_schema.columns
      where table_name = 'trades' and column_name = 'import_key')   as spalte,
    (select count(*) from pg_indexes
      where indexname = 'trades_import_key')                        as index,
    (select count(*) from pg_views
      where viewname = 'auswertung_gebuehren')                      as auswertung;
