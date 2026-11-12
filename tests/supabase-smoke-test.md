# Supabase staging smoke tests

Run these against a fresh staging Supabase project after applying `supabase/schema.sql` and deploying `leadloop-api`.

- [ ] Sign in using an email magic link; reload and confirm the session is restored.
- [ ] Create a workspace; confirm a 14-day trial and owner membership.
- [ ] Enable the public enquiry form; open its link in a private browser; submit valid details and consent; confirm one lead and one linked review task appear.
- [ ] Attempt an enquiry with no name, no email/phone, or no consent; confirm it is rejected and no lead is created.
- [ ] Invite a second user; accept with the invited email; confirm the employee role is applied.
- [ ] Attempt to accept the invitation with a different email or reuse the code; confirm rejection.
- [ ] Create an invoice as owner and finance; reload and confirm the amount/status persist.
- [ ] Attempt a financial write as employee; confirm a 403 response.
- [ ] Create two overlapping appointments for the same assignee; confirm the second is rejected with 409.
- [ ] Create an AI message draft for a contact with recorded consent; confirm it appears as Pending approval and is not sent.
- [ ] Attempt message approval as employee; confirm rejection.
- [ ] Approve the draft as owner; confirm status says awaiting connection and no send occurred.
- [ ] Mark an approved email manually; confirm the status explicitly says delivery was not provider-verified.
- [ ] Confirm the WhatsApp card says not connected until Meta setup and webhooks are actually complete.
- [ ] Confirm a user from one workspace cannot read or change another workspace's records.

Do not switch production traffic from AppDeploy until every applicable test passes and a rollback copy is available.
