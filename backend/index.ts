import {
  router,
  json,
  error,
  requireAuth,
  invites,
  isInviteError,
  db,
  ai,
} from '@appdeploy/sdk';

type MemberRole = 'owner' | 'admin' | 'manager' | 'finance' | 'employee';
type Body = Record<string, unknown>;

function key(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
function memberTable(userId: string) {
  return 'll_memberships_' + key(userId);
}
function workspaceTable(workspaceId: string) {
  return 'll_workspace_' + key(workspaceId);
}
function membersTable(workspaceId: string) {
  return 'll_members_' + key(workspaceId);
}
function dataTable(workspaceId: string, resource: string) {
  return 'll_' + resource + '_' + key(workspaceId);
}
function asBody(value: unknown): Body {
  return value && typeof value === 'object' ? (value as Body) : {};
}
function cleanText(value: unknown, max = 180) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function allowedResource(value: string) {
  return [
    'leads',
    'customers',
    'projects',
    'tasks',
    'quotes',
    'invoices',
    'expenses',
    'campaigns',
    'payments',
    'appointments',
  ].includes(value);
}
async function getMembership(userId: string, workspaceId: string) {
  const page = await db.list<{
    workspaceId: string;
    role: MemberRole;
    email?: string;
  }>(memberTable(userId), { limit: 100 });
  return page.items.find(item => item.workspaceId === workspaceId) || null;
}
async function getWorkspaceProfile(workspaceId: string) {
  const page = await db.list<Body>(workspaceTable(workspaceId), { limit: 10 });
  return page.items.find(item => item.systemType === 'profile') || null;
}
async function authorize(userId: string, workspaceId: string) {
  const membership = await getMembership(userId, workspaceId);
  if (!membership) return null;
  const workspace = await getWorkspaceProfile(workspaceId);
  if (!workspace) return null;
  return { membership, workspace };
}
function canManage(role: MemberRole) {
  return role === 'owner' || role === 'admin';
}
function canWrite(role: MemberRole, resource: string) {
  if (role === 'owner' || role === 'admin' || role === 'manager') return true;
  if (role === 'finance')
    return ['quotes', 'invoices', 'expenses', 'payments', 'customers'].includes(resource);
  return ['leads', 'customers', 'tasks', 'projects', 'campaigns', 'appointments'].includes(
    resource
  );
}
async function listWorkspaceRecords(workspaceId: string, resource: string) {
  const page = await db.list<Record<string, unknown>>(
    dataTable(workspaceId, resource),
    { limit: 100 }
  );
  return page.items.filter(item => item.systemType !== 'seed');
}
async function initializeWorkspaceTables(workspaceId: string) {
  const resources = [
    'leads',
    'customers',
    'projects',
    'tasks',
    'quotes',
    'invoices',
    'expenses',
    'campaigns',
    'payments',
    'appointments',
    'messages',
  ];
  for (const resource of resources) {
    await db.add(dataTable(workspaceId, resource), [
      { systemType: 'seed', createdAt: new Date().toISOString() },
    ]);
  }
}

export const handler = router({
  'GET /api/health': [async () => json({ ok: true, app: 'LeadLoop SA' })],

  'GET /api/public/enquiries/:token': [
    async ctx => {
      const token = cleanText(ctx.params.token, 80);
      if (!token) return error('This enquiry link is invalid.', 404);
      const [mapping] = await db.get<Body>('ll_public_enquiry_tokens', [token], { consistent: true });
      if (!mapping || typeof mapping.workspaceId !== 'string')
        return error('This enquiry link is no longer available.', 404);
      const profile = await getWorkspaceProfile(mapping.workspaceId);
      if (!profile || profile.publicEnquiryToken !== token || profile.publicEnquiryEnabled !== true)
        return error('This enquiry link is no longer available.', 404);
      return json({
        businessName: cleanText(profile.name, 100) || 'Business',
        industry: cleanText(profile.industry, 80),
      });
    },
  ],

  'POST /api/public/enquiries/:token': [
    async ctx => {
      const token = cleanText(ctx.params.token, 80);
      const body = asBody(ctx.body);
      if (cleanText(body.website, 200)) return error('The enquiry could not be submitted.', 400);
      const name = cleanText(body.name, 180);
      const email = cleanText(body.email, 180).toLowerCase();
      const phone = cleanText(body.phone, 50);
      const message = cleanText(body.message, 2000);
      const company = cleanText(body.company, 180);
      const serviceRequested = cleanText(body.serviceRequested, 180);
      if (!name) return error('Your name is required.', 400);
      if (!email && !phone) return error('Add an email address or phone number so the business can respond.', 400);
      if (body.consent !== true) return error('Please confirm that the business may contact you about this enquiry.', 400);
      const [mapping] = await db.get<Body>('ll_public_enquiry_tokens', [token], { consistent: true });
      if (!mapping || typeof mapping.workspaceId !== 'string')
        return error('This enquiry link is no longer available.', 404);
      const workspaceId = mapping.workspaceId;
      const profile = await getWorkspaceProfile(workspaceId);
      if (!profile || profile.publicEnquiryToken !== token || profile.publicEnquiryEnabled !== true)
        return error('This enquiry link is no longer available.', 404);
      const now = new Date().toISOString();
      const lead = {
        name,
        email,
        phone,
        company,
        serviceRequested,
        source: 'Website enquiry',
        status: 'New',
        description: message,
        consentToContact: true,
        consentAt: now,
        workspaceId,
        createdBy: 'public_enquiry_form',
        createdAt: now,
        updatedAt: now,
      };
      const [leadId] = await db.add(dataTable(workspaceId, 'leads'), [lead]);
      if (!leadId) return error('Your enquiry could not be saved. Please try again.', 500);
      let taskCreated = false;
      let taskId: string | undefined;
      try {
        const task = {
          name: 'Review new lead: ' + name,
          title: 'Review new lead: ' + name,
          status: 'Open',
          description: 'Automatically prepared from public website enquiry ' + leadId + '. Review the submitted details and decide the next follow-up. No message has been sent and no due date or commitment has been assumed.',
          sourceLeadId: leadId,
          automationType: 'new_lead_review',
          workspaceId,
          createdBy: 'system_automation',
          createdAt: now,
          updatedAt: now,
        };
        const [createdTaskId] = await db.add(dataTable(workspaceId, 'tasks'), [task]);
        if (createdTaskId) {
          taskCreated = true;
          taskId = createdTaskId;
          await db.add('ll_activity_' + key(workspaceId), [{
            actorId: 'public_enquiry_form',
            actorType: 'system_automation',
            action: 'public_enquiry_received',
            resource: 'leads',
            recordId: leadId,
            summary: 'Received a public website enquiry from ' + name,
            createdAt: now,
          }]);
        }
      } catch (taskError) {
        console.error('LeadLoop public enquiry task creation failed', taskError);
      }
      return json({
        submitted: true,
        leadId,
        taskCreated,
        taskId,
        message: 'Your enquiry has been sent to ' + cleanText(profile.name, 100) + '.',
      }, 201);
    },
  ],

  'GET /api/workspaces': [
    requireAuth(),
    async ctx => {
      const userId = ctx.user!.userId;
      const page = await db.list<{
        workspaceId: string;
        role: MemberRole;
      }>(memberTable(userId), { limit: 100 });
      const workspaces = [];
      for (const item of page.items) {
        const profile = await getWorkspaceProfile(item.workspaceId);
        if (profile) {
          workspaces.push({
            id: item.workspaceId,
            name: profile.name,
            industry: profile.industry,
            currency: profile.currency,
            trialEndsAt: profile.trialEndsAt,
            role: item.role,
          });
        }
      }
      return json({ workspaces });
    },
  ],

  'POST /api/workspaces': [
    requireAuth(),
    async ctx => {
      const body = asBody(ctx.body);
      const name = cleanText(body.name, 100);
      if (!name) return error('Business name is required.', 400);
      const user = ctx.user!;
      const now = new Date();
      const trialEndsAt = new Date(now.getTime() + 14 * 86400000).toISOString();
      const industry = cleanText(body.industry, 80) || 'Other';
      const [workspaceId] = await db.add(
        'll_workspace_registry_' + key(user.userId),
        [{
          name,
          industry,
          ownerId: user.userId,
          createdAt: now.toISOString(),
        }]
      );
      if (!workspaceId)
        return error('Could not create the workspace. Please retry.', 500);

      const profile = {
        systemType: 'profile',
        name,
        industry,
        currency: 'ZAR',
        ownerId: user.userId,
        createdAt: now.toISOString(),
        trialStartedAt: now.toISOString(),
        trialEndsAt,
        trialStatus: 'active',
      };
      const [profileRecordId] = await db.add(workspaceTable(workspaceId), [profile]);
      if (!profileRecordId)
        return error('Could not initialize the workspace profile.', 500);

      const [workspaceMemberId] = await db.add(membersTable(workspaceId), [{
        userId: user.userId,
        email: user.email || '',
        name: user.name || '',
        role: 'owner',
        joinedAt: now.toISOString(),
      }]);
      const [userMembershipId] = await db.add(memberTable(user.userId), [{
        workspaceId,
        role: 'owner',
        email: user.email || '',
        joinedAt: now.toISOString(),
      }]);
      if (!workspaceMemberId || !userMembershipId)
        return error('Workspace setup was incomplete. Please contact support before retrying.', 500);

      await initializeWorkspaceTables(workspaceId);
      return json({
        workspace: {
          id: workspaceId,
          name,
          industry,
          currency: 'ZAR',
          trialEndsAt,
          role: 'owner',
        },
      }, 201);
    },
  ],

  'GET /api/workspaces/:id/overview': [
    requireAuth(),
    async ctx => {
      const workspaceId = ctx.params.id;
      const access = await authorize(ctx.user!.userId, workspaceId);
      if (!access) return error('Workspace not found or access denied.', 403);
      const [leads, customers, projects, tasks, invoices] = await Promise.all([
        listWorkspaceRecords(workspaceId, 'leads'),
        listWorkspaceRecords(workspaceId, 'customers'),
        listWorkspaceRecords(workspaceId, 'projects'),
        listWorkspaceRecords(workspaceId, 'tasks'),
        listWorkspaceRecords(workspaceId, 'invoices'),
      ]);
      const revenue = invoices
        .filter(item => item.status === 'Paid')
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const outstanding = invoices
        .filter(item => item.status !== 'Paid' && item.status !== 'Cancelled')
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
      return json({
        metrics: {
          leads: leads.length,
          customers: customers.length,
          projects: projects.filter(item => item.status !== 'Done').length,
          tasks: tasks.filter(item => item.status !== 'Done').length,
          revenue,
          outstanding,
        },
      });
    },
  ],

  'GET /api/workspaces/:id/members': [
    requireAuth(),
    async ctx => {
      const access = await authorize(ctx.user!.userId, ctx.params.id);
      if (!access) return error('Workspace not found or access denied.', 403);
      const page = await db.list<Record<string, unknown>>(
        membersTable(ctx.params.id),
        { limit: 100 }
      );
      return json({ items: page.items });
    },
  ],

  'POST /api/workspaces/:id/invites': [
    requireAuth(),
    async ctx => {
      const workspaceId = ctx.params.id;
      const access = await authorize(ctx.user!.userId, workspaceId);
      if (!access) return error('Workspace not found or access denied.', 403);
      if (!canManage(access.membership.role))
        return error('Only workspace owners and admins can invite employees.', 403);
      const body = asBody(ctx.body);
      const email = cleanText(body.email, 180).toLowerCase();
      const role = cleanText(body.role, 30) as MemberRole;
      if (!email.includes('@'))
        return error('A valid employee email is required.', 400);
      if (!['employee', 'manager', 'finance', 'admin'].includes(role))
        return error('Choose a valid employee role.', 400);
      try {
        const created = await invites.create({
          resourceType: 'leadloop_workspace',
          authMode: 'required',
          actor: ctx.user!,
          allowList: [email],
          expiresInSec: 7 * 86400,
          context: { workspaceId, role },
        });
        return json({ code: created.code }, 201);
      } catch (err) {
        if (isInviteError(err)) return error(err.code, 400);
        throw err;
      }
    },
  ],

  'POST /api/invites/:code/join': [
    requireAuth(),
    async ctx => {
      try {
        const joined = await invites.join({
          code: ctx.params.code,
          actor: ctx.user!,
        });
        if (joined.resourceType !== 'leadloop_workspace')
          return error('This invitation is not for a LeadLoop workspace.', 400);
        const workspaceId = cleanText(joined.context?.workspaceId, 100);
        const role = cleanText(joined.context?.role, 30) as MemberRole;
        if (!workspaceId || !['employee', 'manager', 'finance', 'admin'].includes(role))
          return error('Invitation details are invalid.', 400);
        const profile = await getWorkspaceProfile(workspaceId);
        if (!profile) return error('The invited workspace could not be found.', 404);
        const user = ctx.user!;
        const [workspaceMemberId] = await db.add(membersTable(workspaceId), [{
          userId: user.userId,
          email: user.email || '',
          name: user.name || '',
          role,
          joinedAt: new Date().toISOString(),
        }]);
        const [userMembershipId] = await db.add(memberTable(user.userId), [{
          workspaceId,
          role,
          email: user.email || '',
          joinedAt: new Date().toISOString(),
        }]);
        if (!workspaceMemberId || !userMembershipId)
          return error('Membership could not be saved. Contact the workspace owner.', 500);
        return json({ joined: true, workspaceId, role });
      } catch (err) {
        if (isInviteError(err)) return error(err.code, 400);
        throw err;
      }
    },
  ],

  'GET /api/workspaces/:id/public-enquiry': [
    requireAuth(),
    async ctx => {
      const workspaceId = ctx.params.id;
      const access = await authorize(ctx.user!.userId, workspaceId);
      if (!access) return error('Workspace not found or access denied.', 403);
      if (!canManage(access.membership.role))
        return error('Only workspace owners and admins can manage the public enquiry form.', 403);
      const profile = await getWorkspaceProfile(workspaceId);
      return json({
        enabled: profile?.publicEnquiryEnabled === true && typeof profile.publicEnquiryToken === 'string',
        token: profile?.publicEnquiryEnabled === true ? profile.publicEnquiryToken : null,
      });
    },
  ],

  'POST /api/workspaces/:id/public-enquiry': [
    requireAuth(),
    async ctx => {
      const workspaceId = ctx.params.id;
      const access = await authorize(ctx.user!.userId, workspaceId);
      if (!access) return error('Workspace not found or access denied.', 403);
      if (!canManage(access.membership.role))
        return error('Only workspace owners and admins can manage the public enquiry form.', 403);
      const profile = await getWorkspaceProfile(workspaceId);
      if (!profile?.id) return error('Workspace profile could not be found.', 404);
      const body = asBody(ctx.body);
      const enabled = body.enabled === true;
      const currentToken = cleanText(profile.publicEnquiryToken, 80);
      const now = new Date().toISOString();
      if (!enabled) {
        const [updated] = await db.tx.update(workspaceTable(workspaceId), [{
          id: String(profile.id),
          record: { publicEnquiryEnabled: false, publicEnquiryToken: null, updatedAt: now },
        }], { patch: true });
        if (!updated) return error('Could not disable the enquiry form. Please retry.', 500);
        if (currentToken) {
          try {
            await db.delete('ll_public_enquiry_tokens', [currentToken]);
          } catch (deleteError) {
            console.error('LeadLoop public enquiry token cleanup failed', deleteError);
          }
        }
        return json({ enabled: false, token: null });
      }
      const token = currentToken || crypto.randomUUID().replace(/-/g, '');
      const updateProfile = db.tx.update(workspaceTable(workspaceId), [{
        id: String(profile.id),
        record: { publicEnquiryEnabled: true, publicEnquiryToken: token, updatedAt: now },
      }], { patch: true });
      if (currentToken) {
        const [updated] = await updateProfile;
        if (!updated) return error('Could not enable the enquiry form. Please retry.', 500);
        const [mapping] = await db.get<Body>('ll_public_enquiry_tokens', [currentToken], { consistent: true });
        if (!mapping) {
          const [mappingId] = await db.tx.add('ll_public_enquiry_tokens', [{ id: currentToken, workspaceId, createdAt: now }]);
          if (!mappingId) return error('The enquiry link could not be activated. Please retry.', 500);
        }
      } else {
        const addToken = db.tx.add('ll_public_enquiry_tokens', [{ id: token, workspaceId, createdAt: now }]);
        await db.transact([addToken, updateProfile]);
      }
      return json({ enabled: true, token });
    },
  ],

  'GET /api/workspaces/:id/integrations/whatsapp': [
    requireAuth(),
    async ctx => {
      const access = await authorize(ctx.user!.userId, ctx.params.id);
      if (!access) return error('Workspace not found or access denied.', 403);
      const profile = access.workspace;
      const connected = profile.whatsappConnectionStatus === 'connected'
        && typeof profile.whatsappBusinessAccountId === 'string'
        && Boolean(profile.whatsappBusinessAccountId);
      return json({
        channel: 'whatsapp',
        connected,
        status: connected ? 'connected' : 'not_connected',
        phoneDisplay: cleanText(profile.whatsappPhoneDisplay, 40) || null,
        connectedAt: cleanText(profile.whatsappConnectedAt, 50) || null,
        canStartEmbeddedSignup: false,
        message: connected
          ? 'A WhatsApp account is recorded for this workspace. Live message handling still requires the approved Meta webhook and messaging services.'
          : 'LeadLoop Meta setup is not complete yet. The Meta developer app, Embedded Signup configuration, required permissions and webhook verification must be completed before businesses can connect their own accounts.',
      });
    },
  ],

  'GET /api/workspaces/:id/messages': [
    requireAuth(),
    async ctx => {
      const access = await authorize(ctx.user!.userId, ctx.params.id);
      if (!access) return error('Workspace not found or access denied.', 403);
      return json({ items: await listWorkspaceRecords(ctx.params.id, 'messages') });
    },
  ],

  'POST /api/workspaces/:id/messages/:messageId/approve': [
    requireAuth(),
    async ctx => {
      const access = await authorize(ctx.user!.userId, ctx.params.id);
      if (!access) return error('Workspace not found or access denied.', 403);
      if (!canManage(access.membership.role))
        return error('Only workspace owners and admins can approve customer messages.', 403);
      const [message] = await db.get<Body>(dataTable(ctx.params.id, 'messages'), [ctx.params.messageId], { consistent: true });
      if (!message) return error('Message draft not found.', 404);
      if (message.status !== 'Pending approval')
        return error('This message is no longer awaiting approval.', 409);
      if (message.consentToContact !== true)
        return error('Contact consent is not recorded for this contact. Do not approve or send this message until consent is verified and recorded.', 409);
      const now = new Date().toISOString();
      const [updated] = await db.tx.update(dataTable(ctx.params.id, 'messages'), [{
        id: ctx.params.messageId,
        record: {
          status: 'Approved - awaiting connection',
          approvalStatus: 'Approved',
          approvedBy: ctx.user!.userId,
          approvedAt: now,
          deliveryStatus: 'Not sent - messaging connection not yet activated',
          updatedAt: now,
        },
      }], { patch: true });
      if (!updated) return error('The message could not be approved. Please refresh and retry.', 500);
      await db.add('ll_activity_' + key(ctx.params.id), [{
        actorId: ctx.user!.userId,
        actorType: 'user',
        action: 'message_approved',
        resource: 'messages',
        recordId: ctx.params.messageId,
        summary: 'Approved a customer message draft. It has not been sent.',
        createdAt: now,
      }]);
      return json({ approved: true, sent: false, status: 'Approved - awaiting connection' });
    },
  ],

  'POST /api/workspaces/:id/messages/:messageId/mark-sent': [
    requireAuth(),
    async ctx => {
      const access = await authorize(ctx.user!.userId, ctx.params.id);
      if (!access) return error('Workspace not found or access denied.', 403);
      if (!canManage(access.membership.role))
        return error('Only workspace owners and admins can update message delivery records.', 403);
      const [message] = await db.get<Body>(dataTable(ctx.params.id, 'messages'), [ctx.params.messageId], { consistent: true });
      if (!message) return error('Message draft not found.', 404);
      if (message.channel !== 'email')
        return error('Manual Gmail handoff is available for email messages only.', 400);
      if (message.approvalStatus !== 'Approved' || message.status !== 'Approved - awaiting connection')
        return error('Approve this email draft before marking it sent.', 409);
      if (message.consentToContact !== true)
        return error('Recorded contact consent is required.', 409);
      const now = new Date().toISOString();
      const [updated] = await db.tx.update(dataTable(ctx.params.id, 'messages'), [{
        id: ctx.params.messageId,
        record: {
          status: 'Sent (marked manually)',
          deliveryStatus: 'Marked sent by user - not provider-verified',
          manuallyMarkedSentBy: ctx.user!.userId,
          manuallyMarkedSentAt: now,
          updatedAt: now,
        },
      }], { patch: true });
      if (!updated) return error('The message status could not be updated. Please refresh and retry.', 500);
      await db.add('ll_activity_' + key(ctx.params.id), [{
        actorId: ctx.user!.userId,
        actorType: 'user',
        action: 'message_marked_sent_manually',
        resource: 'messages',
        recordId: ctx.params.messageId,
        summary: 'User marked an approved email as sent manually. Provider delivery was not verified.',
        createdAt: now,
      }]);
      return json({ updated: true, status: 'Sent (marked manually)', deliveryStatus: 'Marked sent by user - not provider-verified', verified: false });
    },
  ],

  'GET /api/workspaces/:id/:resource': [
    requireAuth(),
    async ctx => {
      const resource = ctx.params.resource;
      const access = await authorize(ctx.user!.userId, ctx.params.id);
      if (!access) return error('Workspace not found or access denied.', 403);
      if (resource === 'assistant') {
        const question = cleanText(ctx.query.question, 1500);
        if (!question) return error('Ask a question first.', 400);
        const resources = ['leads', 'customers', 'projects', 'tasks', 'quotes', 'invoices', 'expenses', 'campaigns', 'payments'];
        const entries = await Promise.all(resources.map(async name => [
          name, await listWorkspaceRecords(ctx.params.id, name)
        ] as const));
        const context = {
          business: access.workspace,
          memberRole: access.membership.role,
          records: Object.fromEntries(entries),
          sourcePolicy: 'This workspace data is the only source of business facts. Unknown or absent fields are not provided.',
        };
        const audit = async (action: string, resourceName: string, recordId: string, summary: string) => {
          await db.add('ll_activity_' + key(ctx.params.id), [{
            actorId: ctx.user!.userId,
            actorType: 'ai_agent',
            action,
            resource: resourceName,
            recordId,
            summary: cleanText(summary, 300),
            createdAt: new Date().toISOString(),
          }]);
        };
        try {
          const result = await ai.run({
            system: `You are LeadLoop AI: the ONE unified AI operating intelligence available throughout this business workspace.

IDENTITY AND ARCHITECTURE:
- You are one persistent, workspace-aware assistant. Do not create, imitate, invoke, or describe separate specialist agents, agent personas, or independent chatbots.
- You handle lead management, incoming customer enquiries, direct customer onboarding, manual customer registration, customer history, tasks, projects, quotes, invoices, expenses, payment records, campaigns, bookkeeping and reporting through this same identity and shared workspace context.
- Treat a new enquiry as a lead unless the user or reliable source explicitly confirms an existing customer relationship.
- Support both lead conversion and direct customer creation. Preserve customer contact details, source, notes and relevant history.
- For customer bookkeeping, connect quotes, invoices, expenses and verified payments to the correct customer using exact existing customer IDs or explicitly supplied customer names. Never guess a match.
- A payment record must represent money actually received and be supported by explicit user confirmation or a verified payment source. An invoice marked Paid is not proof of bank settlement unless supported by evidence.
- When creating a payment record, require the exact amount and customer or invoice reference when known. If the user has not confirmed receipt, save it only as Pending verification, never as Received.
- Use the tools provided to perform authorized work. Do not claim a capability or integration exists unless the corresponding tool and connected service are actually available.
- Treat the active workspace and authenticated member role as the boundaries for every request.

SOURCE-OF-TRUTH AND EVIDENCE:
- Use ONLY facts present in the supplied workspace records, information explicitly provided in the user's current message, or verified results returned by an actually connected and authorized service.
- Never invent, assume, estimate, fill in, or creatively complete names, contact details, services, budgets, dates, amounts, payment status, customer commitments, conversations, lead sources, or business outcomes.
- If information is missing, say "Not provided". If it is not verified, say "Unverified". Never turn an AI suggestion into a business fact or saved record.
- Preserve source information. When a fact comes from a record or connected service, identify its source when useful.
- Do not infer that a lead accepted a quote, became a customer, paid, booked, or replied unless explicit evidence exists.
- Use exact record IDs supplied by workspace data. Never fabricate IDs.
- Tool results are the only proof an action succeeded. If a tool fails, report failure. Never claim an action occurred before confirmation.

PERMISSIONS, PRIVACY AND SAFETY:
- Respect the authenticated member's role and backend-enforced permissions. Never bypass authorization.
- Never access, disclose, or use another workspace's information.
- Do not send external communications, make calls, collect payments, or claim external actions unless a real connected tool is available and its result confirms success.
- You may prepare a customer message draft only by using draft_customer_message with an exact existing lead/customer ID and a recipient taken from that record. Never send a message from the AI drafting tool.
- Customer messages remain pending until an owner/admin approves them. Approval is recorded separately from delivery; never describe an approved message as sent.
- First-contact sending requires explicit recorded consent. Respect opt-outs, applicable direct-marketing rules, rate limits, and provider policies.
- External first-contact messages, quotes, invoices, and other consequential actions must follow the workspace approval policy. A draft or approval request is not approval.
- Respect opt-outs, consent, applicable direct-marketing rules, rate limits, and provider policies whenever messaging integrations are introduced.

BUSINESS OPERATIONS:
- Act on clear, explicit requests using available tools instead of merely giving manual instructions.
- For lead conversion, use convert_lead_to_customer and copy only verified existing lead fields.
- Create or update records only when the user clearly requests it and required information is present.
- For financial records, use exact amounts and currency supplied by verified records or authorized users. Never invent prices, taxes, discounts, expenses, revenue, or payment amounts.
- A draft quote or invoice is not issued, accepted, or paid unless the records explicitly confirm that state.
- Ask one concise clarification when an essential detail is missing or the requested action is ambiguous.
- After an action, report exactly what changed, the affected record, whether it succeeded, and any missing information.

REPORTING:
- Calculate metrics only from supplied workspace records. Distinguish leads discovered, leads contacted, replies, interested prospects, converted customers, quotes, invoices, verified payments, expenses, and collected revenue.
- Do not present estimates as actual results. If a metric is unavailable, say so.
- Be transparent about incomplete data, unavailable integrations, and tool failures.

CORE RULE:
ONE AI. ONE SHARED WORKSPACE CONTEXT. VERIFIED FACTS. AUTHORIZED ACTIONS. NO FABRICATION.`,
            prompt: 'LIVE WORKSPACE DATA (JSON): ' + JSON.stringify(context) + '\n\nUSER REQUEST: ' + question,
            tools: [
              {
                name: 'draft_customer_message',
                description: 'Create a personalized customer message draft for an exact existing lead or customer. Never send it. Derive the recipient only from that record. First-contact sending requires recorded consent and separate human approval.',
                parameters: {
                  type: 'object',
                  properties: {
                    recordType: { type: 'string', enum: ['leads', 'customers'] },
                    recordId: { type: 'string' },
                    channel: { type: 'string', enum: ['email', 'whatsapp'] },
                    subject: { type: 'string' },
                    body: { type: 'string' },
                  },
                  required: ['recordType', 'recordId', 'channel', 'body'],
                  additionalProperties: false,
                },
              },
              {
                name: 'convert_lead_to_customer',
                description: 'Convert an existing lead into a customer using only that lead record. Call only when the user explicitly requests conversion or clearly instructs you to onboard that lead as a customer.',
                parameters: {
                  type: 'object',
                  properties: { leadId: { type: 'string', description: 'Exact existing lead record ID from workspace data.' } },
                  required: ['leadId'],
                  additionalProperties: false,
                },
              },
              {
                name: 'create_workspace_record',
                description: 'Create a requested record in the authenticated workspace. Use only facts explicitly supplied by the user or existing workspace records. For financial records, amount is mandatory and must be explicitly provided.',
                parameters: {
                  type: 'object',
                  properties: {
                    resource: { type: 'string', enum: resources },
                    fields: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' }, title: { type: 'string' },
                        client: { type: 'string' }, email: { type: 'string' },
                        phone: { type: 'string' }, company: { type: 'string' },
                        address: { type: 'string' }, source: { type: 'string' },
                        customerType: { type: 'string' }, customerId: { type: 'string' },
                        invoiceId: { type: 'string' }, paymentMethod: { type: 'string' },
                        reference: { type: 'string' }, paymentDate: { type: 'string' },
                        amount: { type: 'number' }, status: { type: 'string' },
                        description: { type: 'string' }, category: { type: 'string' },
                        dueDate: { type: 'string' },
                      },
                      additionalProperties: false,
                    },
                  },
                  required: ['resource', 'fields'],
                  additionalProperties: false,
                },
              },
              {
                name: 'update_workspace_record',
                description: 'Update an existing record using its exact ID and explicitly requested changes. Never change financial amounts or statuses without clear user instruction and source evidence.',
                parameters: {
                  type: 'object',
                  properties: {
                    resource: { type: 'string', enum: resources },
                    recordId: { type: 'string' },
                    fields: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' }, title: { type: 'string' },
                        client: { type: 'string' }, email: { type: 'string' },
                        phone: { type: 'string' }, company: { type: 'string' },
                        address: { type: 'string' }, source: { type: 'string' },
                        customerType: { type: 'string' }, customerId: { type: 'string' },
                        invoiceId: { type: 'string' }, paymentMethod: { type: 'string' },
                        reference: { type: 'string' }, paymentDate: { type: 'string' },
                        amount: { type: 'number' }, status: { type: 'string' },
                        description: { type: 'string' }, category: { type: 'string' },
                        dueDate: { type: 'string' },
                      },
                      additionalProperties: false,
                    },
                  },
                  required: ['resource', 'recordId', 'fields'],
                  additionalProperties: false,
                },
              },
            ],
            onToolCall: async (name, args) => {
              const role = access.membership.role;
              if (name === 'draft_customer_message') {
                const recordType = cleanText(args.recordType, 20);
                if (recordType !== 'leads' && recordType !== 'customers')
                  return { ok: false, error: 'Choose an existing lead or customer record.' };
                const recordId = cleanText(args.recordId, 100);
                const channel = cleanText(args.channel, 20);
                const body = cleanText(args.body, 4000);
                const subject = cleanText(args.subject, 180);
                if (!recordId || !body || !['email', 'whatsapp'].includes(channel))
                  return { ok: false, error: 'A valid record, channel and message body are required.' };
                const [contact] = await db.get<Body>(dataTable(ctx.params.id, recordType), [recordId], { consistent: true });
                if (!contact) return { ok: false, error: 'The selected contact record was not found.' };
                const recipient = channel === 'email' ? cleanText(contact.email, 180) : cleanText(contact.phone, 50);
                if (!recipient) return { ok: false, error: 'This record does not contain a ' + (channel === 'email' ? 'email address' : 'phone number') + '.' };
                const now = new Date().toISOString();
                const message = {
                  recordType,
                  recordId,
                  contactName: cleanText(contact.name || contact.client || contact.title, 180),
                  channel,
                  recipient,
                  subject: channel === 'email' ? subject : '',
                  body,
                  status: 'Pending approval',
                  approvalStatus: 'Pending',
                  deliveryStatus: 'Not sent',
                  consentToContact: contact.consentToContact === true,
                  createdBy: ctx.user!.userId,
                  createdAt: now,
                  updatedAt: now,
                };
                const [messageId] = await db.add(dataTable(ctx.params.id, 'messages'), [message]);
                if (!messageId) return { ok: false, error: 'The message draft could not be saved.' };
                await audit('message_drafted', 'messages', messageId, 'Prepared a ' + channel + ' draft for ' + message.contactName);
                return { ok: true, action: 'message_drafted', messageId, channel, recipient, status: message.status, consentRecorded: message.consentToContact, deliveryStatus: message.deliveryStatus };
              }
              if (name === 'convert_lead_to_customer') {
                if (!canWrite(role, 'leads') || !canWrite(role, 'customers'))
                  return { ok: false, error: 'Your role cannot convert leads into customers.' };
                const leadId = cleanText(args.leadId, 100);
                if (!leadId) return { ok: false, error: 'A valid lead ID is required.' };
                const [lead] = await db.get<Body>(dataTable(ctx.params.id, 'leads'), [leadId], { consistent: true });
                if (!lead) return { ok: false, error: 'Lead record not found.' };
                if (lead.status === 'Converted' || lead.convertedToCustomerId)
                  return { ok: false, error: 'This lead has already been converted.' };
                const customerName = cleanText(lead.name || lead.client || lead.title, 180);
                if (!customerName) return { ok: false, error: 'The lead has no name. Add the missing name before conversion.' };
                const now = new Date().toISOString();
                const customer = {
                  name: customerName,
                  client: cleanText(lead.client, 180),
                  email: cleanText(lead.email, 180),
                  description: cleanText(lead.description, 2000),
                  amount: Number.isFinite(Number(lead.amount)) ? Number(lead.amount) : 0,
                  status: 'Active',
                  sourceLeadId: leadId,
                  workspaceId: ctx.params.id,
                  createdBy: ctx.user!.userId,
                  createdAt: now,
                  updatedAt: now,
                };
                const addCustomer = db.tx.add(dataTable(ctx.params.id, 'customers'), [customer]);
                const updateLead = db.tx.update(dataTable(ctx.params.id, 'leads'), [{
                  id: leadId,
                  record: { status: 'Converted', convertedAt: now, updatedAt: now },
                }], { patch: true });
                const [customerIds] = await db.transact([addCustomer, updateLead]);
                const customerId = customerIds[0];
                await audit('lead_converted', 'leads', leadId, 'Converted lead ' + customerName + ' into customer ' + customerId);
                return { ok: true, action: 'lead_converted', leadId, customerId, customerName };
              }
              if (name === 'create_workspace_record') {
                const resourceName = cleanText(args.resource, 30);
                if (!allowedResource(resourceName) || !canWrite(role, resourceName))
                  return { ok: false, error: 'Your role cannot create this record.' };
                const fields = asBody(args.fields);
                const recordName = cleanText(fields.name || fields.title || fields.client, 180);
                if (!recordName) return { ok: false, error: 'A name, title, or client is required.' };
                if (['quotes', 'invoices', 'expenses', 'payments'].includes(resourceName) &&
                    (typeof fields.amount !== 'number' || !Number.isFinite(fields.amount)))
                  return { ok: false, error: 'An exact amount explicitly provided by the user is required for this financial record.' };
                const now = new Date().toISOString();
                const record = {
                  name: cleanText(fields.name, 180), title: cleanText(fields.title, 180),
                  client: cleanText(fields.client, 180), email: cleanText(fields.email, 180),
                  phone: cleanText(fields.phone, 50), company: cleanText(fields.company, 180),
                  address: cleanText(fields.address, 500), source: cleanText(fields.source, 100),
                  customerType: cleanText(fields.customerType, 50), customerId: cleanText(fields.customerId, 100),
                  invoiceId: cleanText(fields.invoiceId, 100), paymentMethod: cleanText(fields.paymentMethod, 80),
                  reference: cleanText(fields.reference, 120), paymentDate: cleanText(fields.paymentDate, 40),
                  amount: typeof fields.amount === 'number' ? fields.amount : 0,
                  status: cleanText(fields.status, 40) || 'Open',
                  description: cleanText(fields.description, 2000),
                  category: cleanText(fields.category, 80), dueDate: cleanText(fields.dueDate, 40),
                  workspaceId: ctx.params.id, createdBy: ctx.user!.userId,
                  createdAt: now, updatedAt: now,
                };
                const [id] = await db.add(dataTable(ctx.params.id, resourceName), [record]);
                if (!id) return { ok: false, error: 'The record could not be saved.' };
                await audit('record_created', resourceName, id, 'AI created ' + resourceName + ' record ' + recordName);
                return { ok: true, action: 'record_created', resource: resourceName, recordId: id, name: recordName };
              }
              if (name === 'update_workspace_record') {
                const resourceName = cleanText(args.resource, 30);
                if (!allowedResource(resourceName) || !canWrite(role, resourceName))
                  return { ok: false, error: 'Your role cannot update this record.' };
                const recordId = cleanText(args.recordId, 100);
                const fields = asBody(args.fields);
                const patch: Body = { updatedAt: new Date().toISOString() };
                for (const field of ['name', 'title', 'client', 'email', 'phone', 'company', 'address', 'source', 'customerType', 'customerId', 'invoiceId', 'paymentMethod', 'reference', 'paymentDate', 'status', 'description', 'category', 'dueDate'] as const) {
                  if (typeof fields[field] === 'string') patch[field] = cleanText(fields[field], field === 'description' ? 2000 : 180);
                }
                if (typeof fields.amount === 'number' && Number.isFinite(fields.amount)) patch.amount = fields.amount;
                if (Object.keys(patch).length === 1) return { ok: false, error: 'No valid changes were supplied.' };
                const [updated] = await db.tx.update(dataTable(ctx.params.id, resourceName), [
                  { id: recordId, record: patch },
                ], { patch: true });
                if (!updated) return { ok: false, error: 'Record not found or unchanged.' };
                await audit('record_updated', resourceName, recordId, 'AI updated ' + resourceName + ' record');
                return { ok: true, action: 'record_updated', resource: resourceName, recordId, changedFields: Object.keys(patch).filter(field => field !== 'updatedAt') };
              }
              return { ok: false, error: 'Unknown AI action.' };
            },
            maxSteps: 6,
            maxTokens: 1400,
            thinkingMode: 'FAST',
          });
          return json({ answer: result.text, steps: result.steps });
        } catch (err) {
          console.error('LeadLoop AI agent failed', err);
          return error('LeadLoop AI could not complete the request. No success should be assumed; check the workspace records before retrying.', 503);
        }
      }
      if (!allowedResource(resource)) return error('Unknown workspace resource.', 404);
      return json({ items: await listWorkspaceRecords(ctx.params.id, resource) });
    },
  ],

  'POST /api/workspaces/:id/:resource': [
    requireAuth(),
    async ctx => {
      const resource = ctx.params.resource;
      if (!allowedResource(resource)) return error('Unknown workspace resource.', 404);
      const access = await authorize(ctx.user!.userId, ctx.params.id);
      if (!access) return error('Workspace not found or access denied.', 403);
      if (!canWrite(access.membership.role, resource))
        return error('Your role cannot create records in this section.', 403);
      const body = asBody(ctx.body);
      const title = cleanText(body.name || body.title || body.client || body.description, 180);
      if (!title) return error('A name or title is required.', 400);
      const now = new Date().toISOString();
      let appointmentStart = '';
      let appointmentEnd = '';
      const assignedTo = cleanText(body.assignedTo, 120);
      if (resource === 'appointments') {
        const start = new Date(cleanText(body.startAt, 80));
        const end = new Date(cleanText(body.endAt, 80));
        if (!cleanText(body.name || body.title, 180)) return error('Appointment title is required.', 400);
        if (!cleanText(body.startAt, 80) || !cleanText(body.endAt, 80) || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start)
          return error('Choose a valid start and end time. The end must be after the start.', 400);
        appointmentStart = start.toISOString();
        appointmentEnd = end.toISOString();
        const existingAppointments = await listWorkspaceRecords(ctx.params.id, 'appointments');
        const conflict = existingAppointments.find(item => {
          if (item.status === 'Cancelled' || item.status === 'Completed') return false;
          if (assignedTo && cleanText(item.assignedTo, 120) && cleanText(item.assignedTo, 120) !== assignedTo) return false;
          const existingStart = new Date(String(item.startAt || '')).getTime();
          const existingEnd = new Date(String(item.endAt || '')).getTime();
          return Number.isFinite(existingStart) && Number.isFinite(existingEnd) && start.getTime() < existingEnd && end.getTime() > existingStart;
        });
        if (conflict) return error('That time overlaps an existing appointment. Choose another time or assign a different staff member.', 409);
      }
      const record = {
        name: cleanText(body.name, 180),
        title: cleanText(body.title, 180),
        client: cleanText(body.client, 180),
        email: cleanText(body.email, 180),
        phone: cleanText(body.phone, 50),
        company: cleanText(body.company, 180),
        address: cleanText(body.address, 500),
        source: cleanText(body.source, 100),
        customerType: cleanText(body.customerType, 50),
        customerId: cleanText(body.customerId, 100),
        invoiceId: cleanText(body.invoiceId, 100),
        paymentMethod: cleanText(body.paymentMethod, 80),
        reference: cleanText(body.reference, 120),
        paymentDate: cleanText(body.paymentDate, 40),
        amount: Number.isFinite(Number(body.amount)) ? Number(body.amount) : 0,
        status: cleanText(body.status, 40) || 'Open',
        description: cleanText(body.description, 2000),
        category: cleanText(body.category, 80),
        dueDate: cleanText(body.dueDate, 40),
        service: cleanText(body.service, 180),
        assignedTo,
        location: cleanText(body.location, 500),
        startAt: appointmentStart,
        endAt: appointmentEnd,
        workspaceId: ctx.params.id,
        createdBy: ctx.user!.userId,
        createdAt: now,
        updatedAt: now,
      };
      const [id] = await db.add(dataTable(ctx.params.id, resource), [record]);
      if (!id) return error('The record was not saved. Please retry.', 500);

      let automation: { taskCreated: boolean; taskId?: string; message: string } | undefined;
      if (resource === 'leads') {
        const leadLabel = cleanText(record.name || record.client || record.title, 180);
        const taskNow = new Date().toISOString();
        const task = {
          name: 'Review new lead: ' + leadLabel,
          title: 'Review new lead: ' + leadLabel,
          status: 'Open',
          description: 'Automatically prepared from lead record ' + id + '. Review the information already recorded, identify any missing details, and decide the next follow-up. No customer message has been sent. Do not assume a due date or customer commitment.',
          sourceLeadId: id,
          automationType: 'new_lead_review',
          workspaceId: ctx.params.id,
          createdBy: ctx.user!.userId,
          createdAt: taskNow,
          updatedAt: taskNow,
        };
        try {
          const [taskId] = await db.add(dataTable(ctx.params.id, 'tasks'), [task]);
          if (taskId) {
            await db.add('ll_activity_' + key(ctx.params.id), [{
              actorId: ctx.user!.userId,
              actorType: 'system_automation',
              action: 'lead_review_task_created',
              resource: 'tasks',
              recordId: taskId,
              summary: 'Prepared a review task for new lead ' + leadLabel,
              createdAt: taskNow,
            }]);
            automation = { taskCreated: true, taskId, message: 'A linked lead-review task was created automatically.' };
          } else {
            automation = { taskCreated: false, message: 'The lead was saved, but its review task could not be created.' };
          }
        } catch (automationError) {
          console.error('LeadLoop lead intake automation failed', automationError);
          automation = { taskCreated: false, message: 'The lead was saved, but its review task could not be created.' };
        }
      }
      return json({ item: { id, ...record }, automation }, 201);
    },
  ],

  'PUT /api/workspaces/:id/:resource/:recordId': [
    requireAuth(),
    async ctx => {
      const resource = ctx.params.resource;
      if (!allowedResource(resource)) return error('Unknown workspace resource.', 404);
      const access = await authorize(ctx.user!.userId, ctx.params.id);
      if (!access) return error('Workspace not found or access denied.', 403);
      if (!canWrite(access.membership.role, resource))
        return error('Your role cannot update records in this section.', 403);
      const body = asBody(ctx.body);
      const patch: Body = { updatedAt: new Date().toISOString() };
      if (typeof body.status === 'string') patch.status = cleanText(body.status, 40);
      if (typeof body.description === 'string') patch.description = cleanText(body.description, 2000);
      const [updated] = await db.tx.update(
        dataTable(ctx.params.id, resource),
        [{ id: ctx.params.recordId, record: patch }],
        { patch: true }
      );
      if (!updated) return error('Record not found or unchanged.', 404);
      return json({ updated: true });
    },
  ],

});
