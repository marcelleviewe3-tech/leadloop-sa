# LeadLoop SA standalone Supabase migration

## Current test deployment
- Test site: https://leadloop-sa.pages.dev
- Frontend host: Cloudflare Pages, connected to `marcelleviewe3-tech/leadloop-sa` on `migration/standalone-backend`.
- Build command: `npm run typecheck && npm run build`; output directory: `dist`.
- Supabase project: `vaycxiafwtcjlrylctpj`; Edge Function: `leadloop-api`.
- The AppDeploy production deployment and GitHub `main` branch remain untouched. Do not merge the migration PR or cut over until smoke tests and owner approval are complete.

### One-time Auth setup before the first sign-in
Open [Supabase Auth URL Configuration](https://supabase.com/dashboard/project/vaycxiafwtcjlrylctpj/auth/url-configuration):
1. Set **Site URL** to `https://leadloop-sa.pages.dev`.
2. Add `https://leadloop-sa.pages.dev/**` to **Redirect URLs** and save.
3. In **Authentication → Sign In / Providers → Email**, confirm email sign-in and new-user sign-up are enabled.

For initial testing, use an email address that belongs to the Supabase organization's team. Supabase's built-in email sender only sends to team-member addresses and has a low hourly limit. Sending to arbitrary customers later requires custom SMTP.

### Current feature boundaries
- Lead capture includes phone, company, source and an explicit contact-consent field.
- The unified AI assistant requires `AI_PROVIDER_API_KEY` as a Supabase Edge Function secret. It is not configured yet, so AI requests will return a clear configuration error until a key is added.
- WhatsApp is status-only. Meta onboarding, webhooks and message delivery are not implemented.
- Email drafts open in the user's email app for manual review and sending; LeadLoop does not send them automatically.
- Billing/subscriptions and automated missed-call recovery are not active.


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

**Preview status:** the connected Supabase GitHub app currently reports that “Create a new preview branch per PR” is disabled. In the Supabase project dashboard, open **Project Settings → Integrations** and re-enable preview branch creation if you want the draft PR to receive an isolated preview database. The PR remains a draft and has not changed production.

1. The Supabase GitHub integration expects migrations under `supabase/migrations/`. This branch includes `supabase/migrations/20261112110000_leadloop_standalone.sql` for the preview branch. For a separate fresh staging project without GitHub preview, open **SQL Editor** and run `supabase/schema.sql` once. Do not run both against the same database.
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
