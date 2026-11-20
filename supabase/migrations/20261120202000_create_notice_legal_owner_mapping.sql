create table public.notice_legal_owner_mapping (
 property_name text primary key check (property_name=btrim(property_name) and length(property_name)>0),
 legal_owner text not null check (legal_owner=btrim(legal_owner) and length(legal_owner)>0)
);
create unique index notice_property_case_key on public.notice_legal_owner_mapping(lower(property_name));
alter table public.notice_legal_owner_mapping enable row level security;
revoke all on public.notice_legal_owner_mapping from public, anon, authenticated;
grant select on public.notice_legal_owner_mapping to authenticated;
create policy notice_directory_read on public.notice_legal_owner_mapping for select to authenticated using (true);
create function public.replace_notice_legal_owner_mapping(directory jsonb, expected_directory jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare current_directory jsonb; n integer;
begin
 if auth.uid() is null then raise exception 'Sign in to import the directory'; end if;
 if jsonb_typeof(directory) is distinct from 'array' or jsonb_typeof(expected_directory) is distinct from 'array' then raise exception 'Invalid directory'; end if;
 n:=jsonb_array_length(directory);
 if n=0 or n>20000 then raise exception 'Upload a complete nonempty directory'; end if;
 if exists(select 1 from jsonb_array_elements(directory) e where jsonb_typeof(e->'property_name') is distinct from 'string' or jsonb_typeof(e->'legal_owner') is distinct from 'string' or btrim(e->>'property_name')='' or btrim(e->>'legal_owner')='') then raise exception 'Every property needs a property name and legal owner'; end if;
 if (select count(distinct lower(btrim(e->>'property_name'))) from jsonb_array_elements(directory) e)<>n then raise exception 'Duplicate property name'; end if;
 lock table public.notice_legal_owner_mapping in share row exclusive mode;
 select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) into current_directory from public.notice_legal_owner_mapping m;
 if not (current_directory @> expected_directory and expected_directory @> current_directory) then raise exception 'Directory changed. Refresh and review the upload again.'; end if;
 delete from public.notice_legal_owner_mapping;
 insert into public.notice_legal_owner_mapping select btrim(e->>'property_name'),btrim(e->>'legal_owner') from jsonb_array_elements(directory) e;
 return n;
end $$;
revoke all on function public.replace_notice_legal_owner_mapping(jsonb,jsonb) from public,anon;
grant execute on function public.replace_notice_legal_owner_mapping(jsonb,jsonb) to authenticated;
