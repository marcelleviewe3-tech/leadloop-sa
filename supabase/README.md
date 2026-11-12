# Supabase backend

This directory tracks the SQL migrations and Edge Function source deployed to the LeadLoop SA Supabase project.

## Active runtime

- Project ref: `vaycxiafwtcjlrylctpj`
- Edge Function: `leadloop-api`
- Source: `supabase/functions/leadloop-api/index.ts`
- The function performs its own request authentication. Its gateway JWT verification is disabled because it handles both public routes and routes that validate the bearer token internally.
- Authenticated workspace requests are validated against Supabase Auth and `workspace_members`.
- Public enquiry links use hashed, revocable tokens. Missed-call webhooks use a per-workspace secret hash.
- The service-role key must remain in Supabase Edge Function secrets. Never put it in the browser bundle or repository.

## Browser configuration

The React client uses the Supabase publishable key and project URL in `src/lib/leadloopClient.ts`. The publishable key is designed for browser use; row-level security and Edge Function authorization remain mandatory.

Email sign-in is enabled and new sign-ups are allowed in the current project. Email confirmation is required. Before production sign-in, add the deployed Pages origin to Supabase Auth URL Configuration > Redirect URLs.

## Edge Function secrets

Configure only the secrets needed for the features being enabled:

- `AI_PROVIDER_API_KEY` for the unified AI assistant and missed-call draft generation
- `META_APP_ID`, `META_APP_SECRET`, and `META_CONFIG_ID` for WhatsApp Embedded Signup
- `META_GRAPH_API_VERSION` (optional; the function has a default)
- `LEADLOOP_PUBLIC_APP_URL` for missed-call enquiry-link generation

Do not commit secret values. The migration files and Edge Function source in this directory are the source history; keep them in sync with Supabase when deploying changes.
