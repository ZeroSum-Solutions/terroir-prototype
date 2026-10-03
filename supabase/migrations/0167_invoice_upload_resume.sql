-- Insert-only uploads need no invoice-image SELECT or UPDATE permission.
-- A boolean boundary admits only the current actor's exact pending page.
-- Caller owns the migration-plus-ledger transaction; existing rows are untouched.
do $invoice_creator_preimage$
declare v_function pg_catalog.pg_proc%rowtype;
begin
  select p.* into v_function from pg_catalog.pg_proc p
   where p.oid=pg_catalog.to_regprocedure('public.create_invoice_scan_upload(uuid,uuid,text,text,text,date)');
  if not found or pg_catalog.pg_get_userbyid(v_function.proowner) is distinct from 'postgres'
     or v_function.prosecdef is distinct from true
     or v_function.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.to_jsonb(v_function.proacl) is distinct from
       '["postgres=X/postgres", "authenticated=X/postgres"]'::pg_catalog.jsonb
     or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_function.prosrc,'UTF8')),'hex')
        is distinct from '733e75fdf63e71eb956a4cb798a341e2f7d291a14469b1f6838b68c5fed1be1f' then
    raise exception 'C04_0167_CREATOR_BASELINE_MISMATCH' using errcode='P0001';
  end if;
end;
$invoice_creator_preimage$;

create function public.can_resume_invoice_upload(
  p_restaurant_id uuid,
  p_scan_id uuid,
  p_object_name text,
  p_sha256 text,
  p_byte_size integer,
  p_mime_type text
) returns boolean
language sql stable security definer set search_path = ''
as $function$
  select coalesce(
    (select auth.uid()) is not null
    and p_scan_id is not null
    and p_object_name ~ ('^' || p_restaurant_id::text || '/' || p_scan_id::text
      || '(_page[1-8])?[.](jpg|jpeg|png|heic|heif|pdf)$')
    and p_sha256 ~ '^[0-9a-f]{64}$'
    and p_byte_size between 1 and 10485760
    and p_mime_type in ('image/jpeg','image/png','image/heic','image/heif','application/pdf')
    and public.current_site_role_at_least(p_restaurant_id,'staff')
    and exists (
      select 1 from public.scan_idempotency c
       where c.restaurant_id=p_restaurant_id and c.key=p_scan_id
         and c.claimed_by_user_id=(select auth.uid())
         and c.response_status is null
         and c.response_body='{"version":1,"kind":"invoice_scan_upload","status":"claimed"}'::jsonb
         and c.created_at > statement_timestamp()-interval '24 hours'
    )
    and not exists (select 1 from public.invoice_scans s where s.id=p_scan_id)
    and exists (
      select 1 from storage.objects o
       where o.bucket_id='invoice-images' and o.name=p_object_name
         and coalesce(nullif(o.owner_id,''),o.owner::text)=(select auth.uid())::text
         and o.user_metadata->>'sha256'=p_sha256
         and o.metadata->'size'=to_jsonb(p_byte_size)
         and o.metadata->>'mimetype'=p_mime_type
    ), false
  );
$function$;

alter function public.can_resume_invoice_upload(uuid,uuid,text,text,integer,text) owner to postgres;
revoke all on function public.can_resume_invoice_upload(uuid,uuid,text,text,integer,text)
  from public,anon,authenticated,service_role;
grant execute on function public.can_resume_invoice_upload(uuid,uuid,text,text,integer,text)
  to authenticated;

-- The exact request manifest prevents stale or cross-actor pages from being
-- silently adopted by the internal pre-0167 creator's prefix aggregation.
create function public.create_invoice_scan_upload_manifest(
  p_restaurant_id uuid, p_scan_id uuid, p_object_name text,
  p_distributor_name text, p_invoice_number text, p_invoice_date date,
  p_object_names text[]
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_actor uuid:=(select auth.uid()); v_names text[]; v_expected text[];
 v_prefix text:=p_restaurant_id::text||'/'||p_scan_id::text;
 v_primary text; v_extra jsonb; v_count integer; v_pdf_count integer; v_page_count integer;
begin
  if v_actor is null or not public.current_site_role_at_least(p_restaurant_id,'staff') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_object_names is null or array_ndims(p_object_names) is distinct from 1
     or cardinality(p_object_names) not between 1 and 8
     or p_object_names[1] is distinct from p_object_name
     or (select count(distinct n) from unnest(p_object_names) n) <> cardinality(p_object_names)
     or exists(select 1 from unnest(p_object_names) n where n is null
       or n !~ ('^'||v_prefix||'(_page[1-8])?[.](jpg|jpeg|png|heic|heif|pdf)$')) then
    raise exception 'C04_SCAN_UPLOAD_REFUSED' using errcode='P0001';
  end if;
  select array_agg(n order by n collate "C") into v_expected from unnest(p_object_names) n;
  select array_agg(o.name order by o.name collate "C") into v_names from storage.objects o
   where o.bucket_id='invoice-images'
     and o.name ~ ('^'||v_prefix||'(_page[1-8])?[.](jpg|jpeg|png|heic|heif|pdf)$');
  if v_names is distinct from v_expected
     or exists(select 1 from storage.objects o where o.bucket_id='invoice-images'
       and o.name=any(p_object_names)
       and coalesce(nullif(o.owner_id,''),o.owner::text) is distinct from v_actor::text) then
    raise exception 'C04_SCAN_UPLOAD_REFUSED' using errcode='P0001';
  end if;
  if p_distributor_name is null or octet_length(p_distributor_name) not between 1 and 500
     or (p_invoice_number is not null and octet_length(p_invoice_number)>500) then
    raise exception 'C04_SCAN_UPLOAD_REFUSED' using errcode='P0001';
  end if;
  -- Never reaggregate the prefix through the old helper. Concurrent appended
  -- pages cannot enter this exact manifest/actor-filtered final object set.
  select count(*)::integer,
         count(*) filter(where lower(right(o.name,4))='.pdf')::integer,
         count(*) filter(where o.name ~ ('^'||v_prefix||'_page[1-8][.](jpg|jpeg|png|heic|heif)$'))::integer,
         min(o.name) filter(where o.name=p_object_name),
         coalesce(jsonb_agg(o.name order by o.name) filter(where o.name<>p_object_name),'[]'::jsonb)
    into v_count,v_pdf_count,v_page_count,v_primary,v_extra
    from storage.objects o
   where o.bucket_id='invoice-images' and o.name=any(p_object_names)
     and coalesce(nullif(o.owner_id,''),o.owner::text)=v_actor::text
     and coalesce((o.metadata->>'size')::numeric,-1) between 1 and 10485760
     and o.metadata->>'mimetype' in ('image/jpeg','image/png','image/heic','image/heif','application/pdf');
  if v_primary is null or v_count<>cardinality(p_object_names)
     or (v_pdf_count>0 and (v_pdf_count<>1 or v_count<>1))
     or (v_count>1 and v_page_count<>v_count)
     or (v_count>1 and exists(select 1 from generate_series(1,v_count) n
       where not exists(select 1 from unnest(p_object_names) object_name
         where object_name ~ ('^'||v_prefix||'_page'||n::text||'[.](jpg|jpeg|png|heic|heif)$')))) then
    raise exception 'C04_SCAN_UPLOAD_REFUSED' using errcode='P0001';
  end if;
  insert into public.invoice_scans(
    id,restaurant_id,created_by,distributor_name,invoice_number,invoice_date,
    raw_image_path,extra_image_paths,parsed_line_items,final_line_items,edits,item_count,status
  ) values(p_scan_id,p_restaurant_id,v_actor,p_distributor_name,p_invoice_number,p_invoice_date,
    p_object_name,v_extra,'[]'::jsonb,'[]'::jsonb,'{}'::jsonb,0,'processing');
  perform public.enqueue_invoice_extract_job(p_restaurant_id,p_scan_id);
  return jsonb_build_object('scanId',p_scan_id,'status','queued');
exception
  when sqlstate '42501' then raise exception 'forbidden' using errcode='42501';
  when unique_violation then raise exception 'scan_upload_conflict' using errcode='23505';
  when others then raise exception 'C04_SCAN_UPLOAD_REFUSED' using errcode='P0001';
end;
$function$;
alter function public.create_invoice_scan_upload_manifest(uuid,uuid,text,text,text,date,text[]) owner to postgres;
revoke all on function public.create_invoice_scan_upload_manifest(uuid,uuid,text,text,text,date,text[])
  from public,anon,authenticated,service_role;
grant execute on function public.create_invoice_scan_upload_manifest(uuid,uuid,text,text,text,date,text[])
  to authenticated;
revoke execute on function public.create_invoice_scan_upload(uuid,uuid,text,text,text,date)
  from authenticated;
