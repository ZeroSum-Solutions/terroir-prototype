\set ON_ERROR_STOP on
begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
insert into auth.users(id,email) values('0c40a086-6bdd-4792-aef6-0e141e04a3b9','independent-cost-0c40a086-6bdd-4792-aef6-0e141e04a3b9@terroir.test');
select restaurant_id::text as probe_site from public.memberships where user_id='0c40a086-6bdd-4792-aef6-0e141e04a3b9' \gset
update public.memberships set role='staff' where user_id='0c40a086-6bdd-4792-aef6-0e141e04a3b9';
update public.workspace_memberships set governance_role=null where user_id='0c40a086-6bdd-4792-aef6-0e141e04a3b9';
insert into public.wines(id,restaurant_id,name,producer,vintage,size_ml) values('93d9ba3e-39e3-4a68-a92a-8b20717be59c',:'probe_site'::uuid,'Independent Cost ACL Probe','Synthetic',2024,750);
insert into public.inventory_items(id,wine_id,restaurant_id,quantity,unit_cost,added_via) values('7f32132d-17a6-47b6-b975-9868770c7964','93d9ba3e-39e3-4a68-a92a-8b20717be59c',:'probe_site'::uuid,1,47.75,'manual');
set local role authenticated;
select set_config('request.jwt.claim.sub','0c40a086-6bdd-4792-aef6-0e141e04a3b9',true);
select jsonb_build_object(
 'costCapability',public.effective_site_capability(:'probe_site'::uuid,'cost.read'),
 'governedCostRows',(select count(*) from public.read_inventory_costs(:'probe_site'::uuid,array['93d9ba3e-39e3-4a68-a92a-8b20717be59c'::uuid])),
 'rawCostRows',(select count(*) from public.inventory_items where id='7f32132d-17a6-47b6-b975-9868770c7964'),
 'rawCostValue',(select unit_cost from public.inventory_items where id='7f32132d-17a6-47b6-b975-9868770c7964'),
 'rawSelectACL',has_column_privilege('authenticated','public.inventory_items','unit_cost','SELECT')
);
reset role;
rollback;
select count(*) as residual_probe_users from auth.users where id='0c40a086-6bdd-4792-aef6-0e141e04a3b9';
select count(*) as residual_probe_wines from public.wines where id='93d9ba3e-39e3-4a68-a92a-8b20717be59c';
select count(*) as residual_probe_items from public.inventory_items where id='7f32132d-17a6-47b6-b975-9868770c7964';
