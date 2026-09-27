\set ON_ERROR_STOP on

begin;

create temporary table portable_demo_context (
  expected_database text not null,
  owner_id uuid not null,
  owner_email text not null,
  staff_id uuid not null,
  staff_email text not null,
  restaurant_id uuid not null,
  other_restaurant_id uuid not null,
  wine_id uuid not null,
  staff_wine_id uuid not null,
  bin_id uuid not null,
  list_id uuid not null,
  section_id uuid not null,
  item_id uuid not null,
  staff_item_id uuid not null,
  list_slug text not null
) on commit drop;

insert into portable_demo_context values (
  :'expected_database', :'owner_id'::uuid, :'owner_email',
  :'staff_id'::uuid, :'staff_email', :'restaurant_id'::uuid,
  :'other_restaurant_id'::uuid, :'wine_id'::uuid, :'staff_wine_id'::uuid,
  :'bin_id'::uuid, :'list_id'::uuid, :'section_id'::uuid,
  :'item_id'::uuid, :'staff_item_id'::uuid, :'list_slug'
);

do $$
declare
  c portable_demo_context%rowtype;
  required_table text;
begin
  select * into strict c from portable_demo_context;
  if current_database() <> c.expected_database or c.expected_database <> 'postgres' then
    raise exception 'portable demo database admission failed';
  end if;
  if not exists (
    select 1 from supabase_migrations.schema_migrations where version = '0164'
  ) then
    raise exception 'portable demo requires migrations through 0164';
  end if;
  foreach required_table in array array[
    'restaurants', 'memberships', 'workspace_memberships', 'wines', 'bins',
    'wine_lists', 'wine_list_sections', 'wine_list_items', 'inventory_items',
    'open_bottles', 'pour_events', 'inventory_command_receipts'
  ] loop
    if to_regclass('public.' || required_table) is null then
      raise exception 'portable demo missing table: %', required_table;
    end if;
  end loop;
  if to_regprocedure('public.current_inventory_contract_version()') is null
     or public.current_inventory_contract_version() <> 2 then
    raise exception 'portable demo requires inventory contract 2';
  end if;
  if not exists (
    select 1 from auth.users
     where id = c.owner_id and lower(email) = lower(c.owner_email)
  ) or not exists (
    select 1 from auth.users
     where id = c.staff_id and lower(email) = lower(c.staff_email)
  ) then
    raise exception 'portable demo synthetic auth identity mismatch';
  end if;
  if not exists (
    select 1 from public.memberships
     where restaurant_id = c.restaurant_id
       and user_id = c.owner_id
       and role = 'owner'
       and status = 'active'
  ) then
    raise exception 'portable demo owner membership mismatch';
  end if;
end $$;

do $$
declare
  c portable_demo_context%rowtype;
  staff_bootstrap_restaurant uuid;
  staff_memberships integer;
begin
  select * into strict c from portable_demo_context;
  select count(*) into staff_memberships
    from public.memberships where user_id = c.staff_id;
  if staff_memberships <> 1 then
    raise exception 'portable demo staff bootstrap boundary mismatch';
  end if;
  select restaurant_id into strict staff_bootstrap_restaurant
    from public.memberships where user_id = c.staff_id;
  if staff_bootstrap_restaurant = c.restaurant_id then
    raise exception 'portable demo staff bootstrap boundary mismatch';
  end if;
  delete from public.restaurants where id = staff_bootstrap_restaurant;
  if exists (select 1 from public.memberships where user_id = c.staff_id) then
    raise exception 'portable demo staff bootstrap cleanup failed';
  end if;
  insert into public.memberships (user_id, restaurant_id, role)
  values (c.staff_id, c.restaurant_id, 'staff');
  if not exists (
    select 1 from public.memberships m
    join public.workspace_memberships wm on wm.id = m.workspace_membership_id
     where m.user_id = c.staff_id
       and m.restaurant_id = c.restaurant_id
       and m.role = 'staff'
       and m.status = 'active'
       and wm.status = 'active'
  ) then
    raise exception 'portable demo staff membership link failed';
  end if;
end $$;

do $$
declare c portable_demo_context%rowtype;
begin
  select * into strict c from portable_demo_context;
  if exists (
    select 1 from public.restaurants where id = c.other_restaurant_id
    union all select 1 from public.wines where id in (c.wine_id, c.staff_wine_id)
    union all select 1 from public.bins where id = c.bin_id
    union all select 1 from public.wine_lists where id = c.list_id or slug = c.list_slug
    union all select 1 from public.wine_list_sections where id = c.section_id
    union all select 1 from public.wine_list_items where id in (c.item_id, c.staff_item_id)
  ) then
    raise exception 'portable demo fixture identity already exists';
  end if;
end $$;

update public.restaurants set name = 'Portable Restaurant Demo'
where id = :'restaurant_id'::uuid;

insert into public.restaurants (id, name)
values (:'other_restaurant_id'::uuid, 'Portable Demo Cross-Site Boundary');

insert into public.bins (id, restaurant_id, code, zone, capacity, priority)
values (:'bin_id'::uuid, :'restaurant_id'::uuid, 'DEMO-A1', 'Main Cellar', 12, 100);

insert into public.wines (
  id, restaurant_id, name, producer, vintage, varietal, region, country, size_ml
) values
  (:'wine_id'::uuid, :'restaurant_id'::uuid, 'Restaurant Demo 750',
   'Terroir Demo Estate', 2024, 'Pinot Noir', 'Willamette Valley', 'United States', 750),
  (:'staff_wine_id'::uuid, :'restaurant_id'::uuid,
   'Restaurant Demo Staff Service Pinot Noir With A Deliberately Long Dining-Room Label',
   'Terroir Demo Staff Estate', 2023, 'Pinot Noir', 'Santa Barbara County', 'United States', 750);

insert into public.wine_lists (
  id, restaurant_id, name, template, slug, is_published, archived
) values (
  :'list_id'::uuid, :'restaurant_id'::uuid, 'Portable Demo By the Glass',
  'classic', :'list_slug', false, false
);

insert into public.wine_list_sections (id, wine_list_id, name, position)
values (:'section_id'::uuid, :'list_id'::uuid, 'By the glass', 0);

insert into public.wine_list_items (
  id, section_id, restaurant_id, wine_id, position,
  glass_pour_ml, pour_size_mode, is_available
) values
  (:'item_id'::uuid, :'section_id'::uuid, :'restaurant_id'::uuid,
   :'wine_id'::uuid, 0, 150, 'fixed', true),
  (:'staff_item_id'::uuid, :'section_id'::uuid, :'restaurant_id'::uuid,
   :'staff_wine_id'::uuid, 1, 150, 'fixed', true);

do $$
declare c portable_demo_context%rowtype;
begin
  select * into strict c from portable_demo_context;
  if exists (
    select 1 from public.inventory_items where wine_id in (c.wine_id, c.staff_wine_id)
  ) or exists (
    select 1 from public.open_bottles where wine_id in (c.wine_id, c.staff_wine_id)
  ) or exists (
    select 1 from public.pour_events where wine_id in (c.wine_id, c.staff_wine_id)
  ) or exists (
    select 1 from public.inventory_command_receipts where restaurant_id = c.restaurant_id
  ) then
    raise exception 'portable demo must begin with zero mutable inventory and receipts';
  end if;
end $$;

commit;

select jsonb_build_object(
  'fixture', 'portable-restaurant-demo-0164',
  'database', current_database(),
  'restaurantId', :'restaurant_id'::uuid,
  'ownerId', :'owner_id'::uuid,
  'staffId', :'staff_id'::uuid,
  'wineId', :'wine_id'::uuid,
  'wineName', 'Restaurant Demo 750',
  'staffWineId', :'staff_wine_id'::uuid,
  'staffWineName', 'Restaurant Demo Staff Service Pinot Noir With A Deliberately Long Dining-Room Label',
  'otherRestaurantId', :'other_restaurant_id'::uuid,
  'binId', :'bin_id'::uuid,
  'binCode', 'DEMO-A1',
  'section', 'Main Cellar',
  'glassPourMl', 150,
  'inventorySeedCount', 0,
  'commandReceiptSeedCount', 0,
  'staffRole', 'staff'
);
