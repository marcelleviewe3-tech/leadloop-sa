# Legacy AppDeploy backend snapshot

The files in this directory are retained as migration history only. They import the former `@appdeploy/sdk` and are not the active API runtime.

The active browser client now calls the Supabase Edge Function `leadloop-api`. Do not deploy these legacy handlers or reintroduce the AppDeploy SDK into the frontend. The deployed Supabase function and versioned SQL migrations are tracked separately under the Supabase project.
