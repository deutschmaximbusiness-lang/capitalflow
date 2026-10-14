-- CapitalFlow Krypto Terminal: Push zum Start jeder Session
--
-- Asien (Tokio), London und New York. Ein Zeitplan in Supabase (pg_cron)
-- ruft alle 5 Minuten die Edge Function "terminal-push" auf. Die Funktion
-- prueft selbst, ob gerade eine Session begonnen hat (mit Sommer-/Winterzeit
-- der jeweiligen Boerse), und schickt dann genau einmal eine Nachricht.
--
-- Voraussetzung: 11_push.sql. Mehrfach ausfuehrbar.

-- 1. Pro Geraet: Session-Nachrichten an oder aus (Standard: an)
alter table public.push_abos add column if not exists sessions boolean not null default true;

create or replace function public.push_sessions_setzen(p_endpoint text, p_an boolean)
returns void
language sql
security definer
set search_path = public
as $$
    update public.push_abos set sessions = p_an
     where endpoint = p_endpoint and user_id = auth.uid();
$$;
revoke execute on function public.push_sessions_setzen(text, boolean) from public, anon;
grant execute on function public.push_sessions_setzen(text, boolean) to authenticated;

-- 2. Merkliste: welche Session an welchem Tag schon gemeldet wurde.
--    Der Primaerschluessel verhindert doppelte Nachrichten, auch wenn der
--    Zeitplan zweimal im Fenster laeuft.
create table if not exists public.terminal_session_log (
    tag         date not null,
    session     text not null check (session in ('asien', 'london', 'newyork')),
    gesendet_at timestamptz not null default now(),
    primary key (tag, session)
);
alter table public.terminal_session_log enable row level security;
-- keine Policies: nur die Edge Function (service_role) liest und schreibt
revoke all on public.terminal_session_log from anon, authenticated;

-- 3. Geheimnis fuer den Zeitplan. Liegt verschluesselt im Supabase Vault,
--    steht in keiner Datei. Die Edge Function prueft es ueber diese Funktion.
do $$
begin
    if exists (select 1 from pg_namespace where nspname = 'vault') then
        if not exists (select 1 from vault.secrets where name = 'terminal_cron_secret') then
            perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
                                        'terminal_cron_secret', 'Zeitplan -> terminal-push');
        end if;
        execute $f$
            create or replace function public.terminal_cron_ok(p text)
            returns boolean
            language sql
            security definer
            set search_path = public
            as $q$
                select coalesce(p <> '' and exists (select 1 from vault.decrypted_secrets
                                 where name = 'terminal_cron_secret' and decrypted_secret = p), false)
            $q$;
        $f$;
        execute 'revoke execute on function public.terminal_cron_ok(text) from public, anon, authenticated';
        execute 'grant execute on function public.terminal_cron_ok(text) to service_role';
    end if;
end $$;

-- 4. Zeitplan: alle 5 Minuten. Braucht die Erweiterungen pg_cron und pg_net
--    (in Supabase unter Database -> Extensions, werden hier angelegt).
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
    if exists (select 1 from cron.job where jobname = 'terminal-sessions') then
        perform cron.unschedule('terminal-sessions');
    end if;
    perform cron.schedule('terminal-sessions', '*/5 * * * *', $job$
        select net.http_post(
            url     := 'https://vraymusbcgsoksnsfwiv.supabase.co/functions/v1/terminal-push',
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'terminal_cron_secret')),
            body    := '{"aktion":"session"}'::jsonb,
            timeout_milliseconds := 20000
        );
    $job$);
end $$;

notify pgrst, 'reload schema';
