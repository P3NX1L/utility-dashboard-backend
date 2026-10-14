-- Server-only cache: browsers access explanations through the authenticated FastAPI endpoint.
create table public.bill_explanation_cache (
  evidence_hash text primary key check (length(evidence_hash) = 64),
  import_id uuid not null references public.imports(id),
  bill_version_id uuid not null references public.bill_versions(id),
  status text not null check (status in ('pending', 'ready', 'failed')),
  claimed_at timestamptz not null default now(),
  generated_at timestamptz,
  prompt_version text not null,
  model text not null,
  text text check (char_length(text) <= 180),
  clauses jsonb not null default '[]'::jsonb
);
alter table public.bill_explanation_cache enable row level security;
revoke all on public.bill_explanation_cache from public, anon, authenticated;
grant select, insert, update, delete on public.bill_explanation_cache to service_role;
create index bill_explanation_cache_import_idx on public.bill_explanation_cache(import_id);
create index bill_explanation_cache_version_idx on public.bill_explanation_cache(bill_version_id);
