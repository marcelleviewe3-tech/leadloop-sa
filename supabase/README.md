# Supabase backend

This directory tracks the SQL migrations applied to the LeadLoop SA Supabase project.

## Active runtime

- Project ref: `vaycxiafwtcjlrylctpj`
- Edge Function: `leadloop-api`
- The function performs its own request authentication. Keep its gateway JWT verification setting aligned with the deployed function configuration.
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

Do not commit secret values. The SQL migration files are the source history; the live function source remains deployed in Supabase and should be kept in sync with this repository.
