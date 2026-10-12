-- CapitalFlow Krypto Terminal: Solana im Feed
--
-- Die Thesen kennen bisher nur BTC, ETH und Allgemein. Ohne diese
-- Aenderung scheitert jeder Beitrag mit dem Coin SOL an der Pruefung.
--
-- In Supabase unter SQL Editor ausfuehren. Laeuft mehrfach durch.
-- Setzt 09_terminal.sql voraus.

alter table public.terminal_posts drop constraint if exists terminal_posts_coin_check;
alter table public.terminal_posts add constraint terminal_posts_coin_check
    check (coin in ('BTC', 'ETH', 'SOL', 'ALLGEMEIN'));

notify pgrst, 'reload schema';
