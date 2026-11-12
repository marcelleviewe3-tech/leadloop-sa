create or replace function public.store_workspace_whatsapp_token(
  p_workspace_id uuid,
  p_access_token text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := 'leadloop_whatsapp_' || p_workspace_id::text;
  v_secret_id uuid;
begin
  if p_workspace_id is null or coalesce(length(p_access_token), 0) < 20 then
    raise exception 'A valid workspace and access token are required';
  end if;

  select id into v_secret_id
  from vault.secrets
  where name = v_name
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      p_access_token,
      v_name,
      'WhatsApp Cloud API token for a LeadLoop workspace',
      null
    );
  else
    perform vault.update_secret(
      v_secret_id,
      p_access_token,
      v_name,
      'WhatsApp Cloud API token for a LeadLoop workspace',
      null
    );
  end if;

  return v_name;
end;
$$;

create or replace function public.get_workspace_whatsapp_token(p_workspace_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if p_workspace_id is null then
    raise exception 'Workspace is required';
  end if;

  select ds.decrypted_secret into v_token
  from vault.decrypted_secrets ds
  where ds.name = 'leadloop_whatsapp_' || p_workspace_id::text
  limit 1;

  return v_token;
end;
$$;

revoke all on function public.store_workspace_whatsapp_token(uuid, text) from public, anon, authenticated;
revoke all on function public.get_workspace_whatsapp_token(uuid) from public, anon, authenticated;
grant execute on function public.store_workspace_whatsapp_token(uuid, text) to service_role;
grant execute on function public.get_workspace_whatsapp_token(uuid) to service_role;
