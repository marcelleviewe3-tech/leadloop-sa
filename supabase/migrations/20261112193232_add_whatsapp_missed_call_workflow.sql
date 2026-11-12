create table if not exists public.workspace_whatsapp_accounts (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  waba_id text,
  phone_number_id text,
  display_phone_number text,
  business_name text,
  connection_status text not null default 'not_connected'
    check (connection_status in ('not_connected','pending','connected','needs_reauth','disconnected')),
  token_secret_ref text,
  connected_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.workspace_whatsapp_accounts.token_secret_ref is
  'Reference to a server-side secret in Supabase Vault or an external secret manager. Never store Meta access tokens in this table.';

alter table public.workspace_whatsapp_accounts enable row level security;
grant select, insert, update on public.workspace_whatsapp_accounts to authenticated;

create policy "workspace members can view WhatsApp account"
  on public.workspace_whatsapp_accounts for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy "owners and admins manage WhatsApp account"
  on public.workspace_whatsapp_accounts for all to authenticated
  using (private.current_workspace_role(workspace_id) = any (array['owner','admin']))
  with check (private.current_workspace_role(workspace_id) = any (array['owner','admin']));

create table if not exists public.workspace_call_integrations (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  provider text not null default 'webhook'
    check (provider in ('webhook','twilio','other')),
  business_phone_number text,
  provider_account_ref text,
  connection_status text not null default 'not_configured'
    check (connection_status in ('not_configured','pending','connected','disconnected','error')),
  credential_secret_ref text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.workspace_call_integrations.credential_secret_ref is
  'Reference to a server-side secret. Never store telephony provider credentials in this table.';

alter table public.workspace_call_integrations enable row level security;
grant select, insert, update on public.workspace_call_integrations to authenticated;

create policy "workspace members can view call integration"
  on public.workspace_call_integrations for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy "owners and admins manage call integration"
  on public.workspace_call_integrations for all to authenticated
  using (private.current_workspace_role(workspace_id) = any (array['owner','admin']))
  with check (private.current_workspace_role(workspace_id) = any (array['owner','admin']));

create table if not exists public.workspace_missed_calls (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null default 'webhook',
  provider_call_id text not null,
  caller_phone text not null,
  business_phone text,
  call_started_at timestamptz,
  call_ended_at timestamptz,
  call_outcome text not null default 'missed'
    check (call_outcome in ('missed','no_answer','busy','cancelled')),
  follow_up_status text not null default 'new'
    check (follow_up_status in ('new','drafted','pending_approval','approved','sent','failed','ignored')),
  contact_permission text not null default 'unknown'
    check (contact_permission in ('unknown','opted_in','opted_out')),
  enquiry_url text,
  message_id uuid references public.workspace_messages(id) on delete set null,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, provider_call_id)
);

create index if not exists workspace_missed_calls_workspace_created_idx
  on public.workspace_missed_calls (workspace_id, created_at desc);
create index if not exists workspace_missed_calls_workspace_status_idx
  on public.workspace_missed_calls (workspace_id, follow_up_status);

alter table public.workspace_missed_calls enable row level security;
grant select, update on public.workspace_missed_calls to authenticated;

create policy "workspace members can view missed calls"
  on public.workspace_missed_calls for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy "workspace staff can update missed call follow up"
  on public.workspace_missed_calls for update to authenticated
  using (private.current_workspace_role(workspace_id) = any (array['owner','admin','manager','employee']))
  with check (private.current_workspace_role(workspace_id) = any (array['owner','admin','manager','employee']));
