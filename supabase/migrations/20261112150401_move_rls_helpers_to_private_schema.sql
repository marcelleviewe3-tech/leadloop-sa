-- Keep RLS helper functions out of the exposed public Data API schema.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.current_workspace_role(target_workspace uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select wm.role
  from public.workspace_members wm
  where wm.workspace_id = target_workspace
    and wm.user_id = (select auth.uid())
  limit 1;
$$;

create or replace function private.is_workspace_member(target_workspace uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace
      and wm.user_id = (select auth.uid())
  );
$$;

create or replace function private.can_write_resource(target_workspace uuid, target_resource text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case private.current_workspace_role(target_workspace)
    when 'owner' then true
    when 'admin' then true
    when 'manager' then true
    when 'finance' then target_resource in ('quotes','invoices','expenses','payments','customers')
    when 'employee' then target_resource in ('leads','customers','tasks','projects','campaigns','appointments')
    else false
  end;
$$;

revoke all on function private.current_workspace_role(uuid) from public, anon;
revoke all on function private.is_workspace_member(uuid) from public, anon;
revoke all on function private.can_write_resource(uuid, text) from public, anon;
grant execute on function private.current_workspace_role(uuid) to authenticated;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.can_write_resource(uuid, text) to authenticated;

drop policy if exists "members can view their workspaces" on public.workspaces;
create policy "members can view their workspaces"
  on public.workspaces for select to authenticated
  using (private.is_workspace_member(id));

drop policy if exists "owners and admins can update workspace profile" on public.workspaces;
create policy "owners and admins can update workspace profile"
  on public.workspaces for update to authenticated
  using (private.current_workspace_role(id) in ('owner','admin'))
  with check (private.current_workspace_role(id) in ('owner','admin'));

drop policy if exists "workspace members can view membership" on public.workspace_members;
create policy "workspace members can view membership"
  on public.workspace_members for select to authenticated
  using (private.is_workspace_member(workspace_id));

drop policy if exists "workspace members can view records" on public.workspace_records;
create policy "workspace members can view records"
  on public.workspace_records for select to authenticated
  using (private.is_workspace_member(workspace_id));

drop policy if exists "per-role resource create access" on public.workspace_records;
create policy "per-role resource create access"
  on public.workspace_records for insert to authenticated
  with check (private.can_write_resource(workspace_id, resource) and (created_by is null or created_by = (select auth.uid())));

drop policy if exists "per-role resource update access" on public.workspace_records;
create policy "per-role resource update access"
  on public.workspace_records for update to authenticated
  using (private.can_write_resource(workspace_id, resource))
  with check (private.can_write_resource(workspace_id, resource));

drop policy if exists "workspace members can view messages" on public.workspace_messages;
create policy "workspace members can view messages"
  on public.workspace_messages for select to authenticated
  using (private.is_workspace_member(workspace_id));

drop policy if exists "workspace members can view activity" on public.workspace_activity;
create policy "workspace members can view activity"
  on public.workspace_activity for select to authenticated
  using (private.is_workspace_member(workspace_id));

drop policy if exists "owners and admins can view invitations" on public.workspace_invites;
create policy "owners and admins can view invitations"
  on public.workspace_invites for select to authenticated
  using (private.current_workspace_role(workspace_id) in ('owner','admin'));

drop function if exists public.current_workspace_role(uuid);
drop function if exists public.is_workspace_member(uuid);
drop function if exists public.can_write_resource(uuid, text);
