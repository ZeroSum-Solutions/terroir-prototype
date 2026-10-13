-- Restore compatible insert-only callers before dropping this retry boundary.
-- Caller owns the transaction and ledger removal. No objects/history are deleted.
do $invoice_resume_down$
begin
  if exists(select 1 from (values
    ('public.can_resume_invoice_upload(uuid,uuid,text,text,integer,text)',
     'f6b05cae997b8e0cb3b5fd4947d7ba88ea21e294b9a8aa212193c738bec005bf',
     '["postgres=X/postgres", "authenticated=X/postgres"]'::jsonb,'s'),
    ('public.create_invoice_scan_upload_manifest(uuid,uuid,text,text,text,date,text[])',
     'fa77d68fe522c38215969acf6aa0c18f2609f2bf46ec798c2ae423e9c3ba20b0',
     '["postgres=X/postgres", "authenticated=X/postgres"]'::jsonb,'v'),
    ('public.create_invoice_scan_upload(uuid,uuid,text,text,text,date)',
     '733e75fdf63e71eb956a4cb798a341e2f7d291a14469b1f6838b68c5fed1be1f',
     '["postgres=X/postgres"]'::jsonb,'v')
    ) expected(identity,body_sha256,acl,volatility)
    left join pg_catalog.pg_proc p on p.oid=pg_catalog.to_regprocedure(expected.identity)
    where p.oid is null
      or pg_catalog.pg_get_userbyid(p.proowner) is distinct from 'postgres'
      or p.prosecdef is distinct from true
      or p.provolatile::text is distinct from expected.volatility
      or p.proconfig is distinct from array['search_path=""']::text[]
      or pg_catalog.to_jsonb(p.proacl) is distinct from expected.acl
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')
        is distinct from expected.body_sha256) then
    raise exception 'C04_0167_DOWN_BASELINE_MISMATCH' using errcode='P0001';
  end if;
end;
$invoice_resume_down$;
drop function public.create_invoice_scan_upload_manifest(uuid,uuid,text,text,text,date,text[]) restrict;
drop function public.can_resume_invoice_upload(uuid,uuid,text,text,integer,text) restrict;
grant execute on function public.create_invoice_scan_upload(uuid,uuid,text,text,text,date) to authenticated;
