# LeadLoop SA: standalone backend migration

## Safety boundary
- `main` is the imported AppDeploy snapshot and remains unchanged during this work.
- All migration work belongs on `migration/standalone-backend`.
- The live AppDeploy deployment remains the production reference until the replacement passes parity tests and is deliberately cut over.
- Never copy AppDeploy secrets, service credentials, or customer data into Git.

## Target architecture
- Frontend: existing React 19 + Vite + TypeScript application.
- Identity: Supabase Auth.
- Database: Supabase Postgres with row-level security (RLS).
- Server-side API: Supabase Edge Functions using the service-role key only inside the function runtime.
- AI: a server-side provider adapter; provider keys stay in Edge Function secrets.
- Realtime: Supabase Realtime subscriptions scoped to the authenticated workspace.
- Hosting: static frontend hosting after the backend parity work is complete.

## Existing AppDeploy dependencies to remove
- `@appdeploy/client` in `src/App.tsx`: authentication, API calls, and invitation-link helpers.
- `@appdeploy/sdk` in `backend/index.ts` and realtime files: routing, auth middleware, database, AI, invitation and websocket services.

## Data model mapping
- Dynamic per-workspace AppDeploy tables become `workspaces`, `workspace_members`, and `workspace_records`.
- Resource types: leads, customers, projects, tasks, quotes, invoices, expenses, campaigns, payments, appointments.
- Messages and activity use dedicated `workspace_messages` and `workspace_activity` tables.
- Public enquiry links use `public_enquiry_tokens`; public submissions must go through a validated Edge Function, never a direct anonymous table insert.
- Invitations use hashed one-time codes in `workspace_invites`; acceptance must validate email, expiry, and current auth identity.

## API parity checklist
The current frontend calls these route families. Each must be implemented and tested before removing the AppDeploy client:
- `GET /api/health`
- `GET, POST /api/public/enquiries/:token`
- `GET /api/workspaces`
- `POST /api/workspaces`
- `GET /api/workspaces/:id/overview`
- `GET /api/workspaces/:id/members`
- `POST /api/workspaces/:id/invites`
- `POST /api/invites/:code/join`
- `GET, POST /api/workspaces/:id/public-enquiry`
- `GET /api/workspaces/:id/integrations/whatsapp`
- `GET /api/workspaces/:id/messages`
- `POST /api/workspaces/:id/messages/:messageId/approve`
- `POST /api/workspaces/:id/messages/:messageId/mark-sent`
- `GET, POST /api/workspaces/:id/:resource`
- `PUT /api/workspaces/:id/:resource/:recordId`
- `GET /api/workspaces/:id/assistant`

## Migration stages
1. Add the Supabase schema, RLS policies, client configuration and environment template.
2. Create Edge Functions for auth-aware workspace operations, public enquiries, invitations, messaging approvals, AI assistant and WhatsApp status.
3. Replace `@appdeploy/client` with a compatibility adapter while preserving the existing component behavior.
4. Replace AppDeploy backend and realtime handlers with Edge Functions and Supabase Realtime.
5. Add automated tests for roles, cross-workspace isolation, public enquiry validation, invitations, invoice/calendar flows, assistant and mobile UI.
6. Configure Supabase and hosting secrets, deploy a staging copy, and verify all flows.
7. Cut over only after owner approval and a tested rollback plan.

## Not yet production-ready
This branch is migration scaffolding, not a completed backend replacement. The existing app still imports AppDeploy packages until API and auth parity is implemented. Do not deploy this branch as a standalone production app yet. A Supabase project URL/key and Edge Function secrets must be configured outside GitHub.
