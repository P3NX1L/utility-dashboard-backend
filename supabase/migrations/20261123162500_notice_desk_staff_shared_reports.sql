create table public.notice_desk_staff(user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.notice_desk_staff enable row level security;
revoke all on public.notice_desk_staff from public, anon, authenticated;
grant select on public.notice_desk_staff to authenticated;
create policy own_membership on public.notice_desk_staff for select to authenticated using(user_id=(select auth.uid()));
create table public.notice_shared_reports(kind text primary key check(kind in ('delinquency','tenant_directory')), filename text not null check(length(filename) between 1 and 512), csv_text text not null check(octet_length(csv_text) between 1 and 10485760), revision uuid not null default gen_random_uuid(), updated_at timestamptz not null default now());
alter table public.notice_shared_reports enable row level security;
revoke all on public.notice_shared_reports from public, anon, authenticated;
grant select on public.notice_shared_reports to authenticated;
create policy staff_read on public.notice_shared_reports for select to authenticated using(exists(select 1 from public.notice_desk_staff where user_id=(select auth.uid())));
create function public.replace_notice_shared_report(p_kind text,p_filename text,p_csv text,p_expected uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
if not exists(select 1 from public.notice_desk_staff where user_id=auth.uid()) then raise exception 'Notice Desk staff access required' using errcode='42501'; end if;
if p_expected is null then
insert into public.notice_shared_reports(kind,filename,csv_text) values(p_kind,p_filename,p_csv) on conflict(kind) do nothing returning revision into result;
else
update public.notice_shared_reports set filename=p_filename,csv_text=p_csv,revision=gen_random_uuid(),updated_at=now() where kind=p_kind and revision=p_expected returning revision into result;
end if;
if result is null then raise exception 'Report changed. Reload before updating.' using errcode='40001'; end if;
return result;
end $$;
revoke all on function public.replace_notice_shared_report(text,text,text,uuid) from public,anon;
grant execute on function public.replace_notice_shared_report(text,text,text,uuid) to authenticated;