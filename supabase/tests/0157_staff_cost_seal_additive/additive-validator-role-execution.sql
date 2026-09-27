-- CHECK-constraint validator execution under retained application roles.
\set ON_ERROR_STOP on
\pset pager off
begin;

insert into auth.users(id,email) values
  ('15710000-0000-4000-8000-000000000001','c04-validator@terroir.test');
insert into public.workspaces(id,kind,name) values
  ('15710000-0000-4000-8000-000000000002','restaurant','C04 validator');
insert into public.restaurants(id,name,workspace_id) values
  ('15710000-0000-4000-8000-000000000003','C04 validator site','15710000-0000-4000-8000-000000000002');
insert into public.workspace_memberships(id,workspace_id,user_id) values
  ('15710000-0000-4000-8000-000000000004','15710000-0000-4000-8000-000000000002','15710000-0000-4000-8000-000000000001');
insert into public.memberships(user_id,restaurant_id,role,workspace_membership_id) values
  ('15710000-0000-4000-8000-000000000001','15710000-0000-4000-8000-000000000003','owner','15710000-0000-4000-8000-000000000004');
insert into public.wines(id,restaurant_id,name,producer,size_ml) values
  ('15710000-0000-4000-8000-000000000005','15710000-0000-4000-8000-000000000003','Validator','C04',750);
insert into public.invoice_scans(
  id,restaurant_id,created_by,distributor_name,parsed_line_items,final_line_items,edits,item_count,status
) values(
  '15710000-0000-4000-8000-000000000006','15710000-0000-4000-8000-000000000003',
  '15710000-0000-4000-8000-000000000001','Validator','[]','[]','{}',0,'processing'
);

select set_config('request.jwt.claim.sub','15710000-0000-4000-8000-000000000001',true);
set local role authenticated;
update public.wines set name='Validator authenticated' where id='15710000-0000-4000-8000-000000000005';
update public.invoice_scans set status='review' where id='15710000-0000-4000-8000-000000000006';
do $invalid_metadata$
begin
  begin
    update public.wines set enrichment_metadata='[]'::jsonb
     where id='15710000-0000-4000-8000-000000000005';
    raise exception 'C04_EXPECTED_METADATA_CHECK_REFUSAL';
  exception when check_violation then null;
  end;
end;
$invalid_metadata$;
reset role;

set local role service_role;
update public.wines set name='Validator service' where id='15710000-0000-4000-8000-000000000005';
update public.invoice_scans set status='complete' where id='15710000-0000-4000-8000-000000000006';
reset role;

rollback;
\echo C04_0157_ADDITIVE_VALIDATOR_ROLE_EXECUTION_PASS
