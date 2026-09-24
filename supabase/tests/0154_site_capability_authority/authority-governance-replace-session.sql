\set ON_ERROR_STOP on
\pset pager off

select set_config(
  'request.jwt.claim.sub', '15400000-0000-4000-8000-000000000003', false
);
do $replacement$
declare
  v_error text;
begin
  begin
    perform public.replace_member_site_capabilities(
      '15400000-0000-4000-8000-000000000024',
      array['cost.read'], null, 'C04 governance race replacement'
    );
    raise exception 'C04_EXPECTED_GOVERNANCE_RACE_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_error = message_text;
    if v_error <> 'C04_CALLER_NOT_GOVERNOR' then raise; end if;
  end;
end;
$replacement$;

\echo C04_0154_GOVERNANCE_REPLACEMENT_REFUSED
