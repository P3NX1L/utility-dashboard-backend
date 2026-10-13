-- Backend-only, security-invoker import RPCs. No browser table access is granted.
create or replace function public.stage_utility_import(p_actor_id uuid, p_import jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare v public.imports%rowtype;
begin
  perform 1 from public.app_members where user_id=p_actor_id and active and role in ('admin','reviewer') for share;
  if not found then raise exception using errcode='42501',message='REVIEWER_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(726173831);
  select * into v from public.imports where file_sha256=p_import->>'file_sha256';
  if found then return to_jsonb(v); end if;
  if not exists(select 1 from public.imports where id=(p_import->'scope'->>'base_import_id')::uuid and status='active') then
    raise exception using errcode='P0001',message='IMPORT_NOT_ACTIVE';
  end if;
  if jsonb_typeof(p_import->'scope'->'payload'->'bill_versions') is distinct from 'array'
     or jsonb_array_length(p_import->'scope'->'payload'->'bill_versions')=0
     or jsonb_array_length(p_import->'scope'->'payload'->'bill_versions')>20000 then
    raise exception using errcode='22023',message='INVALID_IMPORT_PAYLOAD';
  end if;
  insert into public.imports(id,filename,storage_path,file_sha256,status,scope,source_exported_at,source_row_count,validation_report,uploaded_by)
  values((p_import->>'id')::uuid,p_import->>'filename',p_import->>'storage_path',p_import->>'file_sha256',
         case when jsonb_array_length(p_import->'scope'->'pending_matches')>0 then 'needs_review' else 'ready' end,
         p_import->'scope',(p_import->>'source_exported_at')::timestamptz,
         (p_import->>'source_row_count')::integer,p_import->'validation_report',p_actor_id) returning * into v;
  return to_jsonb(v);
end $$;

create or replace function public.resolve_utility_match(p_import_id uuid,p_actor_id uuid,p_expected_revision integer,p_source_row_id uuid,p_bill_id uuid)
returns jsonb language plpgsql set search_path='' as $$
declare v public.imports%rowtype; m jsonb; b jsonb; new_versions jsonb; target uuid; account uuid; matched_count integer;
begin
  perform 1 from public.app_members where user_id=p_actor_id and active and role in ('admin','reviewer') for share;
  if not found then raise exception using errcode='42501',message='REVIEWER_REQUIRED'; end if;
  select * into v from public.imports where id=p_import_id for update;
  if not found or v.status not in ('needs_review','ready') then raise exception using errcode='P0001',message='IMPORT_NOT_ACTIVE'; end if;
  if (v.scope->>'revision')::integer<>p_expected_revision then raise exception using errcode='P0001',message='REVISION_CONFLICT'; end if;
  select x into m from jsonb_array_elements(v.scope->'pending_matches') x where x->>'source_row_id'=p_source_row_id::text;
  if m is null then raise exception using errcode='22023',message='MATCH_NOT_PENDING'; end if;
  select x into b from jsonb_array_elements(v.scope->'payload'->'bill_versions') x where x->>'source_row_id'=p_source_row_id::text;
  target:=coalesce(p_bill_id,(b->>'bill_id')::uuid); account:=(b->'match_evidence'->>'account_id')::uuid;
  if p_bill_id is not null then
    if not exists(select 1 from jsonb_array_elements(m->'candidates') c where c->>'bill_id'=p_bill_id::text)
       or not exists(select 1 from public.bills where id=p_bill_id and account_id=account) then
      raise exception using errcode='22023',message='MATCH_NOT_A_CANDIDATE';
    end if;
    if exists(select 1 from jsonb_array_elements(v.scope->'payload'->'bill_versions') x
              where x->>'bill_id'=p_bill_id::text and x->>'source_row_id'<>p_source_row_id::text) then
      raise exception using errcode='22023',message='BILL_ALREADY_MATCHED';
    end if;
  end if;
  b:=jsonb_set(b,'{bill_id}',to_jsonb(target::text));
  b:=jsonb_set(b,'{match_method}','"manual"');
  b:=jsonb_set(b,'{match_evidence,change_kind}',to_jsonb(case when p_bill_id is null then 'new' else 'updated' end));
  b:=jsonb_set(b,'{match_evidence,resolved_by}',to_jsonb(p_actor_id::text));
  select jsonb_agg(case when x->>'source_row_id'=p_source_row_id::text then b else x end) into new_versions
    from jsonb_array_elements(v.scope->'payload'->'bill_versions') x;
  v.scope:=jsonb_set(v.scope,'{payload,bill_versions}',new_versions);
  v.scope:=jsonb_set(v.scope,'{pending_matches}',coalesce((select jsonb_agg(x) from jsonb_array_elements(v.scope->'pending_matches') x
    where x->>'source_row_id'<>p_source_row_id::text),'[]'::jsonb));
  v.scope:=jsonb_set(v.scope,'{revision}',to_jsonb(p_expected_revision+1));
  v.validation_report:=jsonb_set(v.validation_report,'{matching,uncertain}',to_jsonb(jsonb_array_length(v.scope->'pending_matches')));
  v.validation_report:=jsonb_set(v.validation_report,array['matching',case when p_bill_id is null then 'new' else 'updated' end],
    to_jsonb(coalesce((v.validation_report->'matching'->>case when p_bill_id is null then 'new' else 'updated' end)::integer,0)+1));
  select count(*) into matched_count from jsonb_array_elements_text(v.scope->'base_bill_ids') old
    where exists(select 1 from jsonb_array_elements(new_versions) x where x->>'bill_id'=old);
  v.validation_report:=jsonb_set(v.validation_report,'{matching,removed_from_snapshot}',
    to_jsonb(jsonb_array_length(v.scope->'base_bill_ids')-matched_count));
  update public.imports set scope=v.scope,validation_report=v.validation_report,
    status=case when jsonb_array_length(v.scope->'pending_matches')=0 then 'ready' else 'needs_review' end
    where id=p_import_id returning * into v;
  return to_jsonb(v);
end $$;

create or replace function public.activate_utility_import(p_import_id uuid,p_actor_id uuid,p_expected_revision integer,
 p_acknowledge_warnings boolean,p_method text,p_parameters jsonb,p_assessments jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare v public.imports%rowtype; data jsonb; result jsonb; carried record;
begin
  perform 1 from public.app_members where user_id=p_actor_id and active and role='admin' for share;
  if not found then raise exception using errcode='42501',message='ADMIN_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(726173831);
  select * into v from public.imports where id=p_import_id for update;
  if not found or v.status<>'ready' then raise exception using errcode='P0001',message='IMPORT_NOT_ACTIVE'; end if;
  if (v.scope->>'revision')::integer<>p_expected_revision then raise exception using errcode='P0001',message='REVISION_CONFLICT'; end if;
  if not exists(select 1 from public.imports where id=(v.scope->>'base_import_id')::uuid and status='active' for update) then
    raise exception using errcode='P0001',message='IMPORT_NOT_ACTIVE';
  end if;
  if jsonb_array_length(v.scope->'pending_matches')<>0 then raise exception using errcode='22023',message='UNRESOLVED_MATCHES'; end if;
  if jsonb_array_length(coalesce(v.validation_report->'warnings','[]'))>0 and not p_acknowledge_warnings then
    raise exception using errcode='22023',message='ACKNOWLEDGE_WARNINGS'; end if;
  data:=v.scope->'payload';
  insert into public.properties(id,property_key,name)
    select id,property_key,name from jsonb_populate_recordset(null::public.properties,data->'properties')
    on conflict(id) do nothing;
  insert into public.utility_accounts(id,property_id,provider,account_number)
    select id,property_id,provider,account_number from jsonb_populate_recordset(null::public.utility_accounts,data->'utility_accounts')
    on conflict(id) do nothing;
  insert into public.bills(id,account_id)
    select b.id,b.account_id from jsonb_populate_recordset(null::public.bills,data->'bills') b
    where exists(select 1 from jsonb_array_elements(data->'bill_versions') x where x->>'bill_id'=b.id::text)
    on conflict(id) do nothing;
  insert into public.import_rows(id,import_id,sheet_name,row_number,row_kind,raw_data,parse_issues)
    select id,import_id,sheet_name,row_number,row_kind,raw_data,parse_issues from jsonb_populate_recordset(null::public.import_rows,data->'import_rows');
  insert into public.bill_versions(id,bill_id,import_id,source_row_id,category,gl_account,transaction_type,due_date,paid_date,
    payment_reference,description,currency,paid_amount,unpaid_amount,service_start,service_end,period_status,period_evidence,
    reading_type,usage_value,usage_unit,match_method,match_evidence,quality_issues)
    select id,bill_id,import_id,source_row_id,category,gl_account,transaction_type,due_date,paid_date,
    payment_reference,description,currency,paid_amount,unpaid_amount,service_start,service_end,period_status,period_evidence,
    reading_type,usage_value,usage_unit,match_method,match_evidence,quality_issues
    from jsonb_populate_recordset(null::public.bill_versions,data->'bill_versions');
  if (select count(*) from public.bill_versions where import_id=p_import_id)<>(v.validation_report->>'transaction_count')::integer
     or (select coalesce(sum(total_amount*100),0) from public.bill_versions where import_id=p_import_id)
        <>(v.validation_report->'totals_cents'->>'total_cents')::numeric then
    raise exception using errcode='22023',message='IMPORT_TOTALS_MISMATCH'; end if;
  update public.imports set status='archived' where status='active';
  update public.imports set status='active',activated_at=now() where id=p_import_id;
  -- Historical reviews remain attached to stable bills. Only truly unchanged
  -- versions carry their reviewed state; changed bills reopen via stale state.
  for carried in
    update public.investigations i set reviewed_bill_version_id=b.id,revision=i.revision+1,updated_at=now()
    from public.bill_versions b where b.import_id=p_import_id and b.bill_id=i.bill_id
      and b.match_evidence->>'change_kind'='unchanged'
      and i.reviewed_bill_version_id is not null
      and exists(select 1 from public.bill_versions old where old.id=i.reviewed_bill_version_id
        and old.import_id=(v.scope->>'base_import_id')::uuid and old.bill_id=i.bill_id)
    returning i.id,i.status,i.revision,b.id as bill_version_id
  loop
    insert into public.investigation_events(investigation_id,actor_id,event_type,details)
      values(carried.id,p_actor_id,'status_change',jsonb_build_object('from',carried.status,'to',carried.status,
        'revision',carried.revision,'bill_version_id',carried.bill_version_id,'reason','unchanged_import_carry_forward'));
  end loop;
  result:=public.save_analysis_snapshot(p_import_id,p_actor_id,p_method,p_parameters,p_assessments);
  update public.imports set scope=scope-'payload'-'base_bill_ids' where id=p_import_id;
  -- All activation, verification, carry-forward and analysis writes commit together.
  return result || jsonb_build_object('import_id',p_import_id,'activated',true);
end $$;

revoke all on function public.stage_utility_import(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.resolve_utility_match(uuid,uuid,integer,uuid,uuid) from public,anon,authenticated;
revoke all on function public.activate_utility_import(uuid,uuid,integer,boolean,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.stage_utility_import(uuid,jsonb) to service_role;
grant execute on function public.resolve_utility_match(uuid,uuid,integer,uuid,uuid) to service_role;
grant execute on function public.activate_utility_import(uuid,uuid,integer,boolean,text,jsonb,jsonb) to service_role;
