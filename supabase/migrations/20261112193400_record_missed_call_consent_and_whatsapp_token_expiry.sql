alter table public.workspace_missed_calls
  add column if not exists contact_permission_evidence text,
  add column if not exists contact_permission_recorded_by uuid references auth.users(id) on delete set null,
  add column if not exists contact_permission_recorded_at timestamptz;

alter table public.workspace_whatsapp_accounts
  add column if not exists access_token_expires_at timestamptz,
  add column if not exists last_error text;
