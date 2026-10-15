-- CapitalFlow: Zahlen fuer die Verwaltung (Zugaenge)
--
-- Nur fuer den Admin. Wer gerade online ist, kommt nicht aus der Datenbank,
-- sondern live ueber Supabase Realtime (Presence) - siehe js/admin.js.
-- Mehrfach ausfuehrbar.

create or replace function public.admin_statistik()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if not public.ist_admin() then
        raise exception 'Kein Adminrecht.';
    end if;
    return jsonb_build_object(
        'nutzer',         (select count(*) from public.profiles),
        'freigeschaltet', (select count(*) from public.profiles where activated),
        'vip',            (select count(*) from public.profiles where activated and (is_vip or is_admin)),
        'neu_7_tage',     (select count(*) from public.profiles where created_at > now() - interval '7 days'),
        'geraete',        (select count(*) from public.push_abos),
        'session_push',   (select count(*) from public.push_abos where sessions),
        'thesen_30_tage', (select count(*) from public.terminal_posts where created_at > now() - interval '30 days')
    );
end;
$$;

revoke execute on function public.admin_statistik() from public, anon;
grant execute on function public.admin_statistik() to authenticated;

notify pgrst, 'reload schema';
