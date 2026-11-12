create index if not exists workspace_invites_invited_by_idx on public.workspace_invites (invited_by);
create index if not exists workspace_invites_workspace_id_idx on public.workspace_invites (workspace_id);
create index if not exists workspace_messages_approved_by_idx on public.workspace_messages (approved_by);
create index if not exists workspace_messages_created_by_idx on public.workspace_messages (created_by);
create index if not exists workspace_messages_workspace_id_idx on public.workspace_messages (workspace_id);
create index if not exists workspace_records_created_by_idx on public.workspace_records (created_by);
create index if not exists workspaces_created_by_idx on public.workspaces (created_by);

drop policy if exists "authenticated users can create workspaces" on public.workspaces;
create policy "authenticated users can create workspaces"
  on public.workspaces for insert to authenticated
  with check (created_by = (select auth.uid()));
