-- CapitalFlow M2: Zertifikate-Ebene
--
-- products und instruments stehen schon in 01_schema.sql. Was fehlt,
-- sind die Zahlen, die zum einzelnen Trade gehoeren und nicht zum
-- Produkt: zu welchem Kurs des BASISWERTS bin ich rein, wo lag mein
-- Stop auf dem Chart, und was war der Hebel in genau diesem Moment.
--
-- Warum getrennt: der Basispreis eines Knock-Outs gehoert zum Produkt
-- und aendert sich fuer alle gleich. Der Einstiegskurs gehoert zum
-- Trade. Wer beides in eine Tabelle wirft, kann spaeter nicht mehr
-- auswerten, ob zwei Trades dasselbe Zertifikat betrafen.
--
-- In Supabase unter SQL Editor ausfuehren. Laeuft mehrfach durch,
-- ohne Schaden anzurichten.

-- ---------------------------------------------------------------- trades

alter table public.trades
    -- Preise des BASISWERTS. entry_price/exit_price bleiben das, was
    -- tatsaechlich bezahlt wurde - bei einem Zertifikat also der
    -- Zertifikatspreis in Euro. Nur so stimmt die P&L mit dem Depot
    -- ueberein. Die Analyse braucht daneben den Basiswert.
    add column if not exists underlying_entry numeric,
    add column if not exists underlying_exit  numeric,
    -- Der Stop liegt auf dem Chart des Basiswerts, nicht auf dem
    -- Zertifikat - dort koennte ihn niemand ablesen.
    add column if not exists underlying_stop  numeric,
    -- Gerechneter Hebel im Moment des Einstiegs. Wird gespeichert und
    -- nicht bei jeder Auswertung neu ermittelt, weil sich der
    -- Basispreis eines Knock-Outs taeglich verschiebt: in zwei Wochen
    -- kaeme fuer denselben Trade eine andere Zahl heraus.
    add column if not exists leverage_effective numeric,
    -- Abstand zur KO-Schwelle beim Einstieg, in Prozent des Kurses.
    -- Die eigentlich interessante Spalte: sie trennt einen guten
    -- Trade von einem, der nur nicht ausgeknockt wurde.
    add column if not exists ko_distance_percent numeric;

comment on column public.trades.underlying_entry is
    'Kurs des Basiswerts beim Einstieg, in Waehrung des Basiswerts';
comment on column public.trades.leverage_effective is
    'Gerechneter Hebel beim Einstieg: Kurs / innerer Wert. Nicht getippt.';
comment on column public.trades.ko_distance_percent is
    'Abstand zur KO-Schwelle beim Einstieg in Prozent';

-- Plausibilitaet: negative Kurse gibt es nicht, und ein Hebel unter 1
-- waere kein Hebelprodukt. Solche Werte entstehen nur durch
-- vertauschte Eingaben - lieber hier abfangen als spaeter auswerten.
do $$
begin
    if not exists (select 1 from pg_constraint
                   where conname = 'trades_basiswert_positiv') then
        alter table public.trades add constraint trades_basiswert_positiv check (
            (underlying_entry is null or underlying_entry > 0)
            and (underlying_exit is null or underlying_exit > 0)
            and (underlying_stop is null or underlying_stop > 0)
        );
    end if;
    if not exists (select 1 from pg_constraint
                   where conname = 'trades_hebel_plausibel') then
        alter table public.trades add constraint trades_hebel_plausibel check (
            leverage_effective is null
            or (leverage_effective >= 1 and leverage_effective <= 500)
        );
    end if;
    if not exists (select 1 from pg_constraint
                   where conname = 'trades_ko_abstand_plausibel') then
        alter table public.trades add constraint trades_ko_abstand_plausibel check (
            ko_distance_percent is null
            or (ko_distance_percent > 0 and ko_distance_percent <= 100)
        );
    end if;
end $$;

-- -------------------------------------------------------------- products
--
-- Zwei Nutzer, die denselben Knock-Out handeln, sollen dieselbe
-- Produktzeile treffen. Ueber die WKN geht das bereits (Index aus
-- 01_schema.sql). Ohne WKN - und die tippt niemand freiwillig ab -
-- braucht es einen zweiten Weg: gleicher Basiswert, gleiche Richtung,
-- gleicher Basispreis, gleiche Schwelle ist dasselbe Produkt.
create unique index if not exists products_kennzeichen_key
    on public.products (instrument_id, kind, direction, strike, ko_barrier)
    where wkn is null and strike is not null;

-- Faktor-Zertifikate haben keinen Basispreis, dafuer einen Faktor.
create unique index if not exists products_faktor_key
    on public.products (instrument_id, direction, factor)
    where wkn is null and kind = 'faktor';

-- ---------------------------------------------------------------- setups
--
-- Ein geplantes Setup braucht dieselbe Schwelle wie ein Trade - sonst
-- laesst sich vor dem Einstieg nicht warnen, und genau dort ist die
-- Warnung etwas wert. Im Journal ist sie nur noch Rueckblick.
alter table public.setups
    add column if not exists ko_barrier numeric;

comment on column public.setups.ko_barrier is
    'Knockout-Preis des geplanten Scheins, fuer Hebel und Schwellenwarnung';

do $$
begin
    if not exists (select 1 from pg_constraint
                   where conname = 'setups_ko_positiv') then
        alter table public.setups add constraint setups_ko_positiv check (
            ko_barrier is null or ko_barrier > 0
        );
    end if;
end $$;

-- ------------------------------------------------------------ Auswertung
--
-- Wofuer das Ganze da ist: die Frage, ob knappe Abstaende sich
-- auszahlen. Die Vermutung ist, dass sie es nicht tun - aber das soll
-- jeder an seinen eigenen Zahlen sehen, nicht geglaubt bekommen.
create or replace view public.auswertung_ko_abstand as
select
    t.user_id,
    case
        when t.ko_distance_percent <  5 then 'unter 5 %'
        when t.ko_distance_percent < 10 then '5 bis 10 %'
        when t.ko_distance_percent < 20 then '10 bis 20 %'
        else 'ueber 20 %'
    end                                              as gruppe,
    count(*)                                         as trades,
    round(avg(t.leverage_effective), 1)              as hebel_schnitt,
    count(*) filter (where t.pnl > 0)                as gewinner,
    round(100.0 * count(*) filter (where t.pnl > 0) / nullif(count(*), 0), 1)
                                                     as trefferquote,
    round(sum(t.pnl), 2)                             as pnl_summe,
    round(avg(t.pnl_percent), 1)                     as pnl_prozent_schnitt
from public.trades t
where t.status = 'geschlossen'
  and t.ko_distance_percent is not null
-- 1 = user_id, 2 = gruppe. Beide muessen rein, sonst waere die
-- Gruppenspalte nicht aggregiert.
group by 1, 2
order by min(t.ko_distance_percent);

-- Views erben die RLS der Tabelle nicht automatisch - security_invoker
-- sorgt dafuer, dass die Policies des Aufrufers gelten und niemand
-- fremde Zahlen sieht.
alter view public.auswertung_ko_abstand set (security_invoker = on);
grant select on public.auswertung_ko_abstand to authenticated;

-- ------------------------------------------------------------- Kontrolle
select
    (select count(*) from information_schema.columns
      where table_name = 'trades'
        and column_name in ('underlying_entry','underlying_exit',
                            'underlying_stop','leverage_effective',
                            'ko_distance_percent'))            as neue_spalten,
    (select count(*) from pg_indexes
      where tablename = 'products'
        and indexname in ('products_kennzeichen_key','products_faktor_key'))
                                                               as neue_indizes,
    (select count(*) from pg_views where viewname = 'auswertung_ko_abstand')
                                                               as auswertung,
    (select count(*) from information_schema.columns
      where table_name = 'setups' and column_name = 'ko_barrier')
                                                               as setup_schwelle;
