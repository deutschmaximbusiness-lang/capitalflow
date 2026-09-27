-- CapitalFlow: Trades nachtraeglich bearbeiten
--
-- Zwei Dinge, die beide daran haengen, dass man einen Trade spaeter
-- ergaenzen koennen soll.
--
-- 1. Der Setup-Typ hatte nie eine eigene Spalte. Er wurde beim
--    Speichern hinten an die Notizen geklebt ("... Setup: Breakout")
--    und beim Laden als leerer String zurueckgegeben. Wer im Journal
--    "Breakout" angeklickt hat, sah nach dem naechsten Start
--    "Sonstiges" - und der Setup-Filter im Journal hatte genau eine
--    Kategorie. Kein Fehler in der Konsole, nur eine Auswertung, die
--    immer dasselbe sagt.
--
-- 2. Das Bezugsverhaeltnis war beim Import erfunden. Die
--    Trade-Republic-Datei nennt keines, das Schema verlangte aber
--    eines - also stand ueberall 1. Die Hebelrechnung bevorzugt den
--    Weg ueber Bezugsverhaeltnis und Preis, weil der das Aufgeld
--    mitnimmt. Mit einer erfundenen 1 ist dieser Weg aber nicht
--    genauer, sondern falsch: bei einem Schein mit echtem
--    Verhaeltnis 0,1 kommt der zehnfache Hebel heraus. Sichtbar wurde
--    das erst jetzt, weil das Bearbeitungsformular den Wert aus der
--    Datenbank zurueck ins Feld schreibt.
--
--    Deshalb darf ratio ab jetzt leer sein. Leer heisst "unbekannt",
--    und unbekannt rechnet die App ueber den Basispreis - ohne
--    Aufgeld, dafuer richtig.
--
-- In Supabase unter SQL Editor ausfuehren. Laeuft mehrfach durch.

-- ------------------------------------------------- 1. Setup-Typ
alter table public.trades
    add column if not exists setup_type text;

create index if not exists trades_user_setup_idx
    on public.trades (user_id, setup_type) where setup_type is not null;

comment on column public.trades.setup_type is
    'Setup-Kategorie, mehrere durch ", " getrennt (Breakout, Pullback, ...). '
    'Lag frueher als Textzeile in notes und ging beim Laden verloren.';

-- Nachtragen, was bisher in den Notizen stand. Das Muster stammt aus
-- speichern.js: die Zeile "Setup: X" wurde immer als letzte angehaengt.
update public.trades
   set setup_type = trim(substring(notes from 'Setup: (.*)$')),
       notes      = nullif(trim(regexp_replace(notes, '\n*Setup: .*$', '')), '')
 where setup_type is null
   and notes is not null
   and notes ~ 'Setup: .+$';

-- ------------------------------------- 2. Bezugsverhaeltnis darf fehlen
--
-- Die alte Bedingung verlangte bei jedem Zertifikat ein
-- Bezugsverhaeltnis. Basispreis und Richtung bleiben Pflicht - ohne die
-- laesst sich wirklich nichts rechnen. Das Verhaeltnis dagegen
-- verbessert die Rechnung nur, wenn es stimmt.
alter table public.products
    drop constraint if exists products_zertifikat_vollstaendig;

alter table public.products
    add constraint products_zertifikat_vollstaendig check (
        kind not in ('knockout','faktor','optionsschein')
        or (strike is not null and direction is not null)
    );

-- Die erfundenen Einsen wieder entfernen. Betroffen sind genau die
-- Zeilen aus dem CSV-Import: nur der schreibt eine ISIN in products,
-- und er hat ausnahmslos ratio = 1 gesetzt. Von Hand eingetragene
-- Produkte haben keine ISIN und bleiben unangetastet - auch wenn dort
-- jemand bewusst eine 1 eingetragen hat.
update public.products
   set ratio = null
 where isin is not null
   and ratio = 1;

comment on column public.products.ratio is
    'Bezugsverhaeltnis. NULL heisst unbekannt - dann rechnet die App den '
    'Hebel ueber den Basispreis statt ueber den bezahlten Preis. Nie mit '
    'einem Platzhalter fuellen: eine erfundene 1 sieht aus wie eine Angabe.';

-- ---------------------------------------------------- Schema neu laden
notify pgrst, 'reload schema';

-- ------------------------------------------------------------ Kontrolle
select
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'trades'
        and column_name = 'setup_type')                        as spalte_da,
    (select count(*) from public.trades
      where setup_type is not null)                            as mit_setup,
    (select count(*) from public.trades
      where notes like '%Setup: %')                            as rest_in_notes,
    (select count(*) from public.products
      where kind <> 'aktie' and ratio is null)                 as ratio_unbekannt;
