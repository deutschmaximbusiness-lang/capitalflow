-- CapitalFlow Krypto Terminal: Push-Benachrichtigungen (Glocke)
--
-- Jedes Geraet, auf dem jemand die Glocke anschaltet, bekommt hier eine
-- Zeile. Die Edge Function "terminal-push" liest sie mit dem
-- service_role-Schluessel (der liegt nur in Supabase) und schickt bei
-- einer neuen These an alle VIP-Geraete eine Benachrichtigung.
--
-- Mehrfach ausfuehrbar.

create table if not exists public.push_abos (
    endpoint    text primary key check (endpoint ~ '^https://' and length(endpoint) <= 1000),
    user_id     uuid not null references auth.users (id) on delete cascade,
    p256dh      text not null check (length(p256dh) <= 200),
    auth        text not null check (length(auth) <= 100),
    created_at  timestamptz not null default now()
);
create index if not exists push_abos_user on public.push_abos (user_id);

alter table public.push_abos enable row level security;

-- Lesen nur die eigenen Geraete; geschrieben wird nur ueber die zwei
-- Funktionen unten
drop policy if exists push_abos_eigene on public.push_abos;
create policy push_abos_eigene on public.push_abos
    for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.push_abos from anon, authenticated;
grant select on public.push_abos to authenticated;

-- Glocke an. Gehoerte das Geraet vorher einem anderen Konto (gleicher
-- Browser, anderer Login), wird es umgehaengt.
create or replace function public.push_abo_setzen(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.ist_vip() then
        raise exception 'Nur für VIP-Mitglieder';
    end if;
    insert into public.push_abos (endpoint, user_id, p256dh, auth)
    values (p_endpoint, auth.uid(), p_p256dh, p_auth)
    on conflict (endpoint) do update
        set user_id = excluded.user_id, p256dh = excluded.p256dh,
            auth = excluded.auth, created_at = now();
end;
$$;

-- Glocke aus
create or replace function public.push_abo_loeschen(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
    delete from public.push_abos where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke execute on function public.push_abo_setzen(text, text, text) from public, anon;
revoke execute on function public.push_abo_loeschen(text) from public, anon;
grant execute on function public.push_abo_setzen(text, text, text) to authenticated;
grant execute on function public.push_abo_loeschen(text) to authenticated;

notify pgrst, 'reload schema';
