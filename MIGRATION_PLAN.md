# LeadLoop SA: standalone backend migration

## Safety boundary
- `main` is the imported AppDeploy snapshot and remains unchanged.
- All migration work belongs on `migration/standalone-backend`.
- The existing live AppDeploy deployment remains the production reference until staging parity is verified and the owner deliberately cuts over.
- Never commit service-role keys, AI provider keys, customer data, or copied AppDeploy secrets.

## Target architecture
- Frontend: existing React 19 + Vite application.
- Identity: Supabase Auth email magic links.
- Database: Supabase Postgres with row-level security.
- API: Supabase Edge Function `leadloop-api` using server-side service-role credentials only.
- AI: server-side OpenAI-compatible provider adapter; provider key stored only as an Edge Function secret.
- Realtime: not required for the current UI contract; add workspace-scoped Supabase Realtime only if/when the product needs live cross-client updates.

## Migration implementation in this branch
- [x] Add Supabase browser client and public environment template.
- [x] Add relational schema and RLS foundation for workspaces, members, records, messages, activity, invites and public enquiry tokens.
- [x] Add compatibility adapter for the existing frontend API/auth/invite call sites.
- [x] Add the `leadloop-api` Edge Function source with authentication, role checks, workspace CRUD, public enquiries, invitations, message approval, appointment overlap checks and AI tool actions.
- [x] Add Edge Function config with JWT verification disabled at the gateway and bearer-token validation inside the handler, so public enquiry links work without login.
- [x] Remove AppDeploy-specific backend source from this migration branch; `main` retains the original rollback source.
- [x] Remove AppDeploy-specific Vite build environment dependencies.
- [x] Apply the database foundation and hardening migrations to the fresh Supabase test project.
- [x] Deploy the `leadloop-api` Edge Function; Supabase supplies its built-in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` runtime variables.
- [x] Configure Cloudflare Pages for the migration branch, Supabase public frontend variables, automatic deployments, and TypeScript checks before each build.
- [x] Run frontend typecheck/build and Deno Edge Function check on the migration implementation.
- [ ] Set Supabase Auth Site URL to `https://leadloop-sa.pages.dev` and allow `https://leadloop-sa.pages.dev/**` in Redirect URLs.
- [ ] Complete the manual Supabase smoke tests in `tests/supabase-smoke-test.md`.
- [ ] Add `AI_PROVIDER_API_KEY` as an Edge Function secret only if enabling the AI assistant for testing.
- [ ] Verify data migration/import strategy for any real AppDeploy customer records; no customer data is copied automatically by this code.
- [ ] Obtain owner approval for a deliberate production cutover and rollback plan.

## Important
This branch is deployed as a test environment, not a live production cutover. The Auth redirect allow-list still needs the one-time dashboard update above. The AI assistant returns a clear configuration error until `AI_PROVIDER_API_KEY` is set. WhatsApp remains status-only; no Meta messaging or delivery is claimed.
