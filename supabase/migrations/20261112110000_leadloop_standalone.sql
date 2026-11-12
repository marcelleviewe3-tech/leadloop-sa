-- LeadLoop SA standalone database foundation.
-- Apply to a NEW Supabase project only after reviewing the migration plan.
-- Existing AppDeploy storage is not modified by this schema.

create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 180),
  industry text not null default 'Professional services',
  currency text not null default 'ZAR' check (currency = 'ZAR'),
  created_by uuid not null references auth.users(id) on delete restrict,
  public_enquiry_enabled boolean not null default false,
  public_enquiry_token_hash text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','manager','finance','employee')),
  email text,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.workspace_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  resource text not null check (resource in ('leads','customers','projects','tasks','quotes','invoices','expenses','campaigns','payments','appointments')),
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_records_workspace_resource_idx
  on public.workspace_records (workspace_id, resource, created_at desc);
create index if not exists workspace_records_data_gin_idx
  on public.workspace_records using gin (data);

create table if not exists public.workspace_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel text not null default 'email',
  recipient text,
  subject text,
  body text not null default '',
  status text not null default 'Pending approval',
  approval_status text not null default 'Pending approval',
  delivery_status text not null default 'Not sent',
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_activity (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id text,
  actor_type text not null default 'user',
  action text not null,
  resource text,
  record_id uuid,
  summary text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists workspace_activity_recent_idx
  on public.workspace_activity (workspace_id, created_at desc);
create index if not exists workspace_members_user_id_idx
  on public.workspace_members (user_id, workspace_id);

create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin','manager','finance','employee')),
  code_hash text not null unique,
  invited_by uuid not null references auth.users(id) on delete restrict,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.public_enquiry_tokens (
  token_hash text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create or replace function public.current_workspace_role(target_workspace uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select wm.role
  from public.workspace_members wm
  where wm.workspace_id = target_workspace
    and wm.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace and wm.user_id = auth.uid()
  );
$$;

create or replace function public.can_write_resource(target_workspace uuid, target_resource text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case public.current_workspace_role(target_workspace)
    when 'owner' then true
    when 'admin' then true
    when 'manager' then true
    when 'finance' then target_resource in ('quotes','invoices','expenses','payments','customers')
    when 'employee' then target_resource in ('leads','customers','tasks','projects','campaigns','appointments')
    else false
  end;
$$;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_records enable row level security;
alter table public.workspace_messages enable row level security;
alter table public.workspace_activity enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.public_enquiry_tokens enable row level security;

drop policy if exists "members can view their workspaces" on public.workspaces;
create policy "members can view their workspaces"
  on public.workspaces for select to authenticated
  using (public.is_workspace_member(id));

drop policy if exists "authenticated users can create workspaces" on public.workspaces;
create policy "authenticated users can create workspaces"
  on public.workspaces for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists "owners and admins can update workspace profile" on public.workspaces;
create policy "owners and admins can update workspace profile"
  on public.workspaces for update to authenticated
  using (public.current_workspace_role(id) in ('owner','admin'))
  with check (public.current_workspace_role(id) in ('owner','admin'));

drop policy if exists "workspace members can view membership" on public.workspace_members;
create policy "workspace members can view membership"
  on public.workspace_members for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members can view records" on public.workspace_records;
create policy "workspace members can view records"
  on public.workspace_records for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "per-role resource create access" on public.workspace_records;
create policy "per-role resource create access"
  on public.workspace_records for insert to authenticated
  with check (public.can_write_resource(workspace_id, resource) and (created_by is null or created_by = auth.uid()));

drop policy if exists "per-role resource update access" on public.workspace_records;
create policy "per-role resource update access"
  on public.workspace_records for update to authenticated
  using (public.can_write_resource(workspace_id, resource))
  with check (public.can_write_resource(workspace_id, resource));

drop policy if exists "workspace members can view messages" on public.workspace_messages;
create policy "workspace members can view messages"
  on public.workspace_messages for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members can view activity" on public.workspace_activity;
create policy "workspace members can view activity"
  on public.workspace_activity for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "owners and admins can view invitations" on public.workspace_invites;
create policy "owners and admins can view invitations"
  on public.workspace_invites for select to authenticated
  using (public.current_workspace_role(workspace_id) in ('owner','admin'));

-- Invite writes and public enquiry token operations are server-only.
-- No anonymous policies are granted. Edge Functions must validate requests
-- and use the service-role key only in server-side runtime secrets.


-- Compatibility fields required by the original LeadLoop workspace profile.
alter table public.workspaces add column if not exists trial_started_at timestamptz not null default now();
alter table public.workspaces add column if not exists trial_ends_at timestamptz not null default (now() + interval '14 days');
alter table public.workspaces add column if not exists settings jsonb not null default '{}'::jsonb;
alter table public.workspace_messages add column if not exists consent_to_contact boolean not null default false;
alter table public.workspace_messages add column if not exists data jsonb not null default '{}'::jsonb;
alter table public.public_enquiry_tokens add column if not exists token_value text;

create index if not exists public_enquiry_tokens_workspace_active_idx
  on public.public_enquiry_tokens (workspace_id) where revoked_at is null;

-- The token value is readable only by the server-side service-role client.
-- RLS is enabled and deliberately has no authenticated or anonymous SELECT policy.
