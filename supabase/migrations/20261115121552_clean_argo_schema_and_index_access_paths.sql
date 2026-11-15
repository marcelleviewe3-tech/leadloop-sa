drop schema if exists argo_private cascade;
create index if not exists argo_conversations_user_idx on public.argo_conversations (user_id);
create index if not exists argo_messages_workspace_idx on public.argo_messages (workspace_id);
create index if not exists argo_actions_conversation_idx on public.argo_action_proposals (conversation_id);
create index if not exists argo_actions_proposed_by_idx on public.argo_action_proposals (proposed_by);
create index if not exists argo_actions_approved_by_idx on public.argo_action_proposals (approved_by);
