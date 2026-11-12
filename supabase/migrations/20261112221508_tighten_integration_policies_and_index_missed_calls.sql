create index if not exists workspace_missed_calls_contact_permission_recorded_by_idx
  on public.workspace_missed_calls (contact_permission_recorded_by);
create index if not exists workspace_missed_calls_message_id_idx
  on public.workspace_missed_calls (message_id);

drop policy if exists "owners and admins manage call integration" on public.workspace_call_integrations;
create policy "owners and admins insert call integration"
  on public.workspace_call_integrations for insert to authenticated
  with check (private.current_workspace_role(workspace_id) = any (array['owner','admin']));
create policy "owners and admins update call integration"
  on public.workspace_call_integrations for update to authenticated
  using (private.current_workspace_role(workspace_id) = any (array['owner','admin']))
  with check (private.current_workspace_role(workspace_id) = any (array['owner','admin']));
create policy "owners and admins delete call integration"
  on public.workspace_call_integrations for delete to authenticated
  using (private.current_workspace_role(workspace_id) = any (array['owner','admin']));

drop policy if exists "owners and admins manage WhatsApp account" on public.workspace_whatsapp_accounts;
create policy "owners and admins insert WhatsApp account"
  on public.workspace_whatsapp_accounts for insert to authenticated
  with check (private.current_workspace_role(workspace_id) = any (array['owner','admin']));
create policy "owners and admins update WhatsApp account"
  on public.workspace_whatsapp_accounts for update to authenticated
  using (private.current_workspace_role(workspace_id) = any (array['owner','admin']))
  with check (private.current_workspace_role(workspace_id) = any (array['owner','admin']));
create policy "owners and admins delete WhatsApp account"
  on public.workspace_whatsapp_accounts for delete to authenticated
  using (private.current_workspace_role(workspace_id) = any (array['owner','admin']));
