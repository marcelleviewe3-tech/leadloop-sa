# LeadLoop SA standalone Supabase migration

This branch is an isolated migration copy. The original `main` branch and the live AppDeploy deployment are intentionally untouched.

## Architecture

- React 19 + Vite frontend.
- Supabase Auth using email magic links.
- Supabase Postgres with row-level security.
- One Supabase Edge Function (`leadloop-api`) for the existing workspace API.
- AI calls run server-side only; the provider key is never included in frontend variables.

## Implemented on this branch

- Supabase browser client and compatibility adapter replacing the React app's `@appdeploy/client` import.
- Edge Function API for health, workspaces, overview, team membership, invitations, public enquiries, WhatsApp connection status, message approvals, records and appointments.
- Server-side bearer-token validation and workspace role checks.
- Hashed one-time invite codes and hashed public enquiry tokens.
- Lead review task creation, appointment overlap checks, message consent and manual-send audit trail.
- AI assistant route with server-side OpenAI-compatible tool calls. It drafts only; it never sends customer messages.
- SQL schema extensions for trial dates, workspace settings, message consent and private public-link token storage.

## Supabase setup (do this before deploying this branch)

1. In the Supabase project, open **SQL Editor** and run `supabase/schema.sql` from this branch.
2. In **Project Settings → API**, copy the Project URL and anon/public key. Put them in the frontend host as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. In **Authentication → URL Configuration**, add the deployed site URL to the allowed redirect URLs. Enable email sign-in / magic links.
4. Deploy `supabase/functions/leadloop-api/index.ts` as the `leadloop-api` Edge Function.
5. Add Edge Function secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and (when AI is needed) `AI_PROVIDER_API_KEY`. The service-role key must only be set as a Supabase Edge Function secret, never as a `VITE_` variable or committed file.
6. Set the frontend host to build this branch with `npm run build`.

## Important limitations before cutover

- The migration branch is not production-ready until the SQL is applied, the Edge Function is deployed, email auth redirect settings are configured, and the smoke tests pass against a staging Supabase project.
- AI requires a valid server-side `AI_PROVIDER_API_KEY`.
- WhatsApp remains an honest status-only integration. Meta Embedded Signup, webhook verification and message delivery are not implemented here.
- The existing AppDeploy deployment remains the production reference until the owner verifies parity and deliberately switches hosting.
- No AppDeploy secrets or customer data are copied into Git.

## Local development

Copy `.env.example` to `.env.local` and set only the two public Supabase browser values. Then run `npm install`, `npm run typecheck`, and `npm run build`.
