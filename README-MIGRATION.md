# LeadLoop SA migration notes

The current app is a React/Vite frontend plus an AppDeploy-hosted API. The original deployment is intentionally left running while this branch is migrated.

## Current status
- [x] 13-file AppDeploy source snapshot imported into private GitHub repository
- [x] Isolated migration branch created
- [x] Initial Supabase relational schema and row-level security foundation added
- [x] Supabase browser client and environment template added
- [ ] Implement API parity in Supabase Edge Functions
- [ ] Replace AppDeploy auth/API/invite client in the React app
- [ ] Replace AppDeploy realtime subscriptions
- [ ] Add integration tests and deploy a staging copy
- [ ] Verify and approve production cutover

## Important
The original `src/App.tsx` and `backend/index.ts` still depend on AppDeploy packages. This branch is not yet independently deployable. Do not remove those imports until replacement routes and tests are ready.

Apply `supabase/schema.sql` only to a separate Supabase project. Never commit a service-role key or customer data.
