-- The shared audit trigger runs on tables that do not have a status column.
-- Read status through the generic JSON payload so PostgreSQL does not try to
-- resolve OLD.status/NEW.status for product_variants and other audited tables.
create or replace function private.capture_audit_log()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  old_json jsonb;
  new_json jsonb;
  changed text[];
  target_id uuid;
  audit_action text := tg_op;
begin
  old_json := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  new_json := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  target_id := coalesce((new_json ->> 'id')::uuid, (old_json ->> 'id')::uuid);

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(key order by key), '{}')
      into changed
      from jsonb_object_keys(old_json || new_json) key
      where old_json -> key is distinct from new_json -> key;
  else
    changed := array[]::text[];
  end if;

  if tg_table_name = 'products'
    and tg_op = 'UPDATE'
    and (old_json ->> 'status') is distinct from (new_json ->> 'status')
  then
    if new_json ->> 'status' = 'active' then
      audit_action := 'PUBLISH';
    elsif new_json ->> 'status' = 'archived' then
      audit_action := 'ARCHIVE';
    end if;
  end if;

  insert into public.audit_logs(
    table_name, record_id, action, changed_fields, old_data, new_data, actor_user_id
  ) values (
    tg_table_name, target_id, audit_action, changed, old_json, new_json, auth.uid()
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
