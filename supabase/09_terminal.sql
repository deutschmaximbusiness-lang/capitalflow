-- CapitalFlow Krypto Terminal (Stufe 1)
--
-- 1. VIP-Kennzeichen am Profil. Gesetzt wird es nur ueber die
--    Admin-Funktion unten - wie is_admin kann niemand es selbst setzen.
-- 2. Der Feed: Thesen mit Bild/Chart und eingebettete X-Posts.
--    Lesen duerfen VIPs (und Admins), schreiben nur Admins.
-- 3. Ein privater Bucket fuer die Bilder im Feed, gleiche Regeln.
--
-- In Supabase unter SQL Editor ausfuehren. Laeuft mehrfach durch.
-- Setzt 07_admin.sql voraus (is_admin, ist_admin()).

-- ------------------------------------------------------------ 1. VIP
alter table public.profiles
    add column if not exists is_vip boolean not null default false;

comment on column public.profiles.is_vip is
    'Zugang zum Krypto Terminal. Wird nur ueber vip_setzen() gesetzt.';

create or replace function public.ist_vip()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce((select (is_vip or is_admin) and activated
                       from public.profiles where id = auth.uid()), false)
$$;

grant execute on function public.ist_vip() to authenticated;

-- VIP an- und ausschalten, ueber die Einladung (so steht es in der
-- Zugangsliste, die der Admin ohnehin sieht)
create or replace function public.vip_setzen(id uuid, vip boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    einl public.invites%rowtype;
begin
    if not public.ist_admin() then
        raise exception 'Kein Adminrecht.';
    end if;
    select * into einl from public.invites where invites.id = vip_setzen.id;
    if not found then
        raise exception 'Diese Einladung gibt es nicht.';
    end if;
    if einl.used_by is null then
        raise exception 'Der Schlüssel ist noch nicht eingelöst.';
    end if;
    update public.profiles set is_vip = vip where profiles.id = einl.used_by;
    return jsonb_build_object('ok', true, 'vip', vip);
end;
$$;

revoke all on function public.vip_setzen(uuid, boolean) from public, anon;
grant execute on function public.vip_setzen(uuid, boolean) to authenticated;

-- Die Zugangsliste zeigt jetzt auch, wer VIP ist
create or replace function public.einladungen_liste()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    ergebnis jsonb;
begin
    if not public.ist_admin() then
        raise exception 'Kein Adminrecht.';
    end if;

    select coalesce(jsonb_agg(z order by z->>'name'), '[]'::jsonb)
      into ergebnis
      from (
        select jsonb_build_object(
            'id',       i.id,
            'name',     i.name,
            'note',     i.note,
            'revoked',  i.revoked,
            'used',     i.used_by is not null,
            'used_at',  i.used_at,
            'created',  i.created_at,
            'konto',    p.name,
            'vip',      coalesce(p.is_vip, false)
        ) as z
        from public.invites i
        left join public.profiles p on p.id = i.used_by
      ) t;

    return ergebnis;
end;
$$;

revoke all on function public.einladungen_liste() from public, anon;
grant execute on function public.einladungen_liste() to authenticated;

-- ------------------------------------------------------------ 2. Feed
create table if not exists public.terminal_posts (
    id          uuid primary key default gen_random_uuid(),
    author      uuid not null references auth.users(id) on delete cascade
                default auth.uid(),
    art         text not null default 'these' check (art in ('these', 'tweet')),
    coin        text check (coin in ('BTC', 'ETH', 'ALLGEMEIN')),
    richtung    text check (richtung in ('long', 'short', 'neutral')),
    titel       text check (titel is null or char_length(titel) <= 140),
    text        text check (text is null or char_length(text) <= 5000),
    bild_pfad   text,
    chart_url   text check (chart_url is null or chart_url ~ '^https://'),
    tweet_url   text check (tweet_url is null
                    or tweet_url ~ '^https://(x|twitter)\.com/[A-Za-z0-9_]{1,15}/status/[0-9]{5,25}'),
    angeheftet  boolean not null default false,
    created_at  timestamptz not null default now(),
    -- Leere Beitraege gibt es nicht
    constraint terminal_posts_inhalt check (
        coalesce(btrim(titel), '') <> '' or coalesce(btrim(text), '') <> ''
        or bild_pfad is not null or chart_url is not null or tweet_url is not null)
);

create index if not exists terminal_posts_zeit_idx
    on public.terminal_posts (angeheftet desc, created_at desc);

alter table public.terminal_posts enable row level security;

grant select, insert, update, delete on public.terminal_posts to authenticated;
revoke all on public.terminal_posts from anon;

drop policy if exists terminal_lesen on public.terminal_posts;
create policy terminal_lesen on public.terminal_posts
    for select to authenticated using (public.ist_vip());

drop policy if exists terminal_schreiben on public.terminal_posts;
create policy terminal_schreiben on public.terminal_posts
    for insert to authenticated
    with check (public.ist_admin() and author = (select auth.uid()));

drop policy if exists terminal_aendern on public.terminal_posts;
create policy terminal_aendern on public.terminal_posts
    for update to authenticated
    using (public.ist_admin()) with check (public.ist_admin());

drop policy if exists terminal_loeschen on public.terminal_posts;
create policy terminal_loeschen on public.terminal_posts
    for delete to authenticated using (public.ist_admin());

-- Neue Beitraege erscheinen bei allen sofort (Supabase Realtime).
-- Lokal ohne Supabase gibt es die Publikation nicht - dann ueberspringen.
do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables
                        where pubname = 'supabase_realtime'
                          and schemaname = 'public' and tablename = 'terminal_posts') then
        execute 'alter publication supabase_realtime add table public.terminal_posts';
    end if;
end $$;

-- ------------------------------------------------------------ 3. Bilder
insert into storage.buckets (id, name, public)
values ('terminal', 'terminal', false)
on conflict (id) do nothing;

do $$
declare p text;
begin
    foreach p in array array['terminal_bild_lesen', 'terminal_bild_hoch',
                             'terminal_bild_aendern', 'terminal_bild_weg'] loop
        execute format('drop policy if exists %I on storage.objects', p);
    end loop;
end $$;

create policy terminal_bild_lesen on storage.objects
    for select to authenticated
    using (bucket_id = 'terminal' and public.ist_vip());
create policy terminal_bild_hoch on storage.objects
    for insert to authenticated
    with check (bucket_id = 'terminal' and public.ist_admin());
create policy terminal_bild_aendern on storage.objects
    for update to authenticated
    using (bucket_id = 'terminal' and public.ist_admin());
create policy terminal_bild_weg on storage.objects
    for delete to authenticated
    using (bucket_id = 'terminal' and public.ist_admin());

notify pgrst, 'reload schema';
