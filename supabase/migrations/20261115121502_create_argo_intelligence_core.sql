create schema if not exists argo_private;

revoke all on schema argo_private from public, anon, authenticated;
grant usage on schema argo_private to service_role;

create table if not exists argo_private.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation' check (char_length(title) between 1 and 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists argo_private.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references argo_private.conversations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 12000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists argo_private.memory (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  memory_key text not null check (char_length(memory_key) between 1 and 180),
  memory_type text not null default 'business_context' check (memory_type in ('business_context', 'customer_preference', 'operating_rule', 'verified_fact')),
  content jsonb not null default '{}'::jsonb,
  confidence numeric(4,3) not null default 1.000 check (confidence >= 0 and confidence <= 1),
  source text not null default 'owner_input',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, memory_key)
);

create table if not exists argo_private.action_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid references argo_private.conversations(id) on delete set null,
  proposed_by uuid not null references auth.users(id),
  action_type text not null check (char_length(action_type) between 1 and 100),
  payload jsonb not null default '{}'::jsonb,
  rationale text not null default '',
  status text not null default 'pending_approval' check (status in ('pending_approval', 'approved', 'rejected', 'executed', 'failed')),
  approved_by uuid references auth.users(id),
  executed_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists argo_conversations_workspace_updated_idx
  on argo_private.conversations (workspace_id, updated_at desc);
create index if not exists argo_messages_conversation_created_idx
  on argo_private.messages (conversation_id, created_at asc);
create index if not exists argo_memory_workspace_type_idx
  on argo_private.memory (workspace_id, memory_type);
create index if not exists argo_actions_workspace_status_idx
  on argo_private.action_proposals (workspace_id, status, created_at desc);

revoke all on all tables in schema argo_private from public, anon, authenticated;
grant all on all tables in schema argo_private to service_role;
