-- Read-only admission probe for 0158. Keep the bottle save route drained from
-- this probe through migration apply and exact-RPC caller deployment.
\set ON_ERROR_STOP on
\pset pager off

\if :{?bottle_route_drained}
\else
  \echo C04_0158_ROUTE_DRAIN_ACK_REQUIRED
  \quit 3
\endif
\if :bottle_route_drained
\else
  \echo C04_0158_ROUTE_DRAIN_ACK_REQUIRED
  \quit 3
\endif

select 'C04_0158_EXECUTOR' as evidence,current_database(),current_user,session_user,
       r.rolsuper,r.rolbypassrls
from pg_catalog.pg_roles r where r.rolname=current_user;

begin;
lock table public.scan_idempotency in share row exclusive mode nowait;
lock table public.inventory_command_receipts in access exclusive mode nowait;

do $preflight$
begin
  if public.current_inventory_contract_version()<>2
     or to_regprocedure('public.current_site_role_at_least(uuid,public.membership_role)') is null
     or to_regprocedure('public.claim_scan_idempotency(uuid,uuid,text)') is null
     or to_regprocedure('public.complete_scan_idempotency(uuid,uuid,text,uuid,integer,integer,uuid)') is null
     or to_regprocedure('public.find_or_create_wines_batch(uuid,jsonb)') is null
     or to_regrole('postgres') is null then
    raise exception 'C04_0158_REQUIRED_BASELINE_MISSING';
  end if;
  if to_regprocedure('public.read_current_operational_memberships(uuid)') is not null
     or to_regprocedure('public.save_bottle_inventory_private(uuid,uuid,text,text,integer,text,text,text,text,integer,numeric)') is not null
     or exists(select 1 from public.inventory_command_receipts where command_version=3) then
    raise exception 'C04_0158_ALREADY_OR_PARTIALLY_APPLIED';
  end if;
  if exists(
    select 1 from public.scan_idempotency c
     where c.claimed_by_user_id is not null
       and jsonb_typeof(c.response_body)='object'
       and jsonb_typeof(c.response_body->'kind')='string'
       and c.response_body->>'kind'='bottle_inventory_save'
  ) then
    raise exception 'C04_0158_UNBACKFILLABLE_BOTTLE_TRANSPORT_CLAIM';
  end if;
end;
$preflight$;
rollback;

\echo C04_0158_PRODUCTION_PREFLIGHT_PASS_ROUTE_REMAINS_DRAINED
