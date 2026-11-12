import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
class HttpError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const resources = ["leads", "customers", "projects", "tasks", "quotes", "invoices", "expenses", "campaigns", "payments", "appointments"];
type User = { id: string; email?: string; user_metadata?: Record<string, unknown> };
type Access = { workspace: any; role: string };
const bodyOf = async (req: Request) => { try { return await req.json(); } catch { return {}; } };
const clean = (v: unknown, max = 180) => typeof v === "string" ? v.trim().slice(0, max) : "";
const obj = (v: unknown) => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : {};
const sha = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map(x => x.toString(16).padStart(2, "0")).join("");
const randomCode = () => crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
const roleCanWrite = (role: string, resource: string) => ["owner", "admin", "manager"].includes(role) || (role === "finance" && ["quotes", "invoices", "expenses", "payments", "customers"].includes(resource)) || (role === "employee" && ["leads", "customers", "tasks", "projects", "campaigns", "appointments"].includes(resource));
const canManage = (role: string) => role === "owner" || role === "admin";
const validResource = (r: string) => resources.includes(r);
async function userFrom(req: Request): Promise<User> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError("Please sign in to continue.", 401);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError("Your session is invalid or has expired. Please sign in again.", 401);
  return data.user as User;
}
async function accessFor(user: User, workspaceId: string): Promise<Access> {
  const { data: membership, error: mErr } = await admin.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  if (mErr) throw mErr;
  if (!membership) throw new HttpError("Workspace not found or access denied.", 403);
  const { data: workspace, error: wErr } = await admin.from("workspaces").select("*").eq("id", workspaceId).maybeSingle();
  if (wErr) throw wErr;
  if (!workspace) throw new HttpError("Workspace not found or access denied.", 403);
  return { workspace, role: membership.role };
}
const profileOut = (w: any, role: string) => ({ id: w.id, name: w.name, industry: w.industry, currency: w.currency || "ZAR", role, trialStartedAt: w.trial_started_at, trialEndsAt: w.trial_ends_at });
async function listRecords(workspaceId: string, resource: string) {
  const { data, error } = await admin.from("workspace_records").select("id,data,created_by,created_at,updated_at").eq("workspace_id", workspaceId).eq("resource", resource).order("created_at", { ascending: false }).limit(500);
  if (error) throw error;
  return (data || []).map(row => ({ ...obj(row.data), id: row.id, workspaceId, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at }));
}
async function addRecord(workspaceId: string, resource: string, fields: Record<string, any>, userId: string | null) {
  const { data, error } = await admin.from("workspace_records").insert({ workspace_id: workspaceId, resource, data: fields, created_by: userId }).select("id,data,created_by,created_at,updated_at").single();
  if (error) throw error;
  return { ...obj(data.data), id: data.id, workspaceId, createdBy: data.created_by, createdAt: data.created_at, updatedAt: data.updated_at };
}
async function updateRecord(workspaceId: string, resource: string, id: string, patch: Record<string, any>) {
  const { data: current, error: getError } = await admin.from("workspace_records").select("data").eq("workspace_id", workspaceId).eq("resource", resource).eq("id", id).maybeSingle();
  if (getError) throw getError;
  if (!current) throw new HttpError("Record not found or unchanged.", 404);
  const { error } = await admin.from("workspace_records").update({ data: { ...obj(current.data), ...patch }, updated_at: new Date().toISOString() }).eq("workspace_id", workspaceId).eq("resource", resource).eq("id", id);
  if (error) throw error;
  return true;
}
async function audit(workspaceId: string, actorId: string, actorType: string, action: string, resource: string, recordId: string | null, summary: string) {
  const { error } = await admin.from("workspace_activity").insert({ workspace_id: workspaceId, actor_id: actorId, actor_type: actorType, action, resource, record_id: recordId, summary: clean(summary, 300) });
  if (error) console.error("activity log failed", error.message);
}
async function tokenWorkspace(token: string) {
  const hash = await sha(token);
  const { data: entry, error } = await admin.from("public_enquiry_tokens").select("workspace_id,revoked_at").eq("token_hash", hash).maybeSingle();
  if (error) throw error;
  if (!entry || entry.revoked_at) throw new HttpError("This enquiry link is no longer available.", 404);
  const { data: workspace, error: wErr } = await admin.from("workspaces").select("*").eq("id", entry.workspace_id).maybeSingle();
  if (wErr) throw wErr;
  if (!workspace || !workspace.public_enquiry_enabled || workspace.public_enquiry_token_hash !== hash) throw new HttpError("This enquiry link is no longer available.", 404);
  return workspace;
}
async function messageList(workspaceId: string) {
  const { data, error } = await admin.from("workspace_messages").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(500);
  if (error) throw error;
  return (data || []).map(m => ({ ...obj(m.data), id: m.id, workspaceId, channel: m.channel, recipient: m.recipient, subject: m.subject, body: m.body, status: m.status, approvalStatus: m.approval_status, deliveryStatus: m.delivery_status, createdBy: m.created_by, approvedBy: m.approved_by, createdAt: m.created_at, updatedAt: m.updated_at }));
}
async function handleAI(workspaceId: string, user: User, access: Access, question: string) {
  const key = Deno.env.get("AI_PROVIDER_API_KEY");
  if (!key) throw new HttpError("LeadLoop AI is not configured yet. Add AI_PROVIDER_API_KEY to the Supabase Edge Function secrets.", 503);
  const names = ["leads", "customers", "projects", "tasks", "quotes", "invoices", "expenses", "campaigns", "payments"];
  const pairs = await Promise.all(names.map(async name => [name, await listRecords(workspaceId, name)] as const));
  const context = { business: { name: access.workspace.name, industry: access.workspace.industry, currency: access.workspace.currency }, memberRole: access.role, records: Object.fromEntries(pairs) };
  const system = `You are LeadLoop AI, one workspace-aware business assistant. Use only supplied records and the user's request. Never invent names, contact details, dates, amounts, payments, commitments or outcomes. Say Not provided or Unverified when appropriate. Respect the authenticated role. Never send messages or claim an external action. You may prepare message drafts only for existing contacts and only when consent is recorded; drafts require owner/admin approval. Use exact record IDs from the workspace. A payment is received only when the user explicitly confirms receipt. Never treat an invoice marked Paid as proof of settlement. Ask one concise clarification when essential data is missing. The workspace data is: ${JSON.stringify(context)}`;
  const tools = [
    { type: "function", function: { name: "draft_customer_message", description: "Create a message draft for an existing lead or customer. Never send it. Recipient must come from that record and recorded consent is required.", parameters: { type: "object", properties: { recordType: { type: "string", enum: ["leads", "customers"] }, recordId: { type: "string" }, channel: { type: "string", enum: ["email", "whatsapp"] }, subject: { type: "string" }, body: { type: "string" } }, required: ["recordType", "recordId", "channel", "body"], additionalProperties: false } } },
    { type: "function", function: { name: "convert_lead_to_customer", description: "Convert an exact existing lead only when the user explicitly asks.", parameters: { type: "object", properties: { leadId: { type: "string" } }, required: ["leadId"], additionalProperties: false } } },
    { type: "function", function: { name: "create_workspace_record", description: "Create a requested workspace record using only explicit facts. Exact amount required for financial records.", parameters: { type: "object", properties: { resource: { type: "string", enum: resources }, fields: { type: "object" } }, required: ["resource", "fields"], additionalProperties: false } } },
    { type: "function", function: { name: "update_workspace_record", description: "Update an exact existing record using explicitly requested fields.", parameters: { type: "object", properties: { resource: { type: "string", enum: resources }, recordId: { type: "string" }, fields: { type: "object" } }, required: ["resource", "recordId", "fields"], additionalProperties: false } } },
  ];
  const messages: any[] = [{ role: "system", content: system }, { role: "user", content: question }];
  const steps: any[] = [];
  for (let turn = 0; turn < 4; turn++) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-4o-mini", messages, tools, tool_choice: "auto", max_tokens: 1400 }) });
    if (!response.ok) throw new HttpError("LeadLoop AI provider request failed. Check the server-side AI key and provider account.", 503);
    const payload = await response.json();
    const msg = payload.choices?.[0]?.message;
    if (!msg) throw new HttpError("LeadLoop AI returned an empty response.", 503);
    if (!msg.tool_calls?.length) return { answer: msg.content || "No answer was returned.", steps };
    messages.push(msg);
    for (const call of msg.tool_calls) {
      let args: any;
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = {}; }
      const result = await runAITool(call.function.name, args, workspaceId, user, access);
      steps.push(result);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return { answer: "I completed the authorized workspace actions available in this request. Review the activity log for the exact changes.", steps };
}
async function runAITool(name: string, args: any, workspaceId: string, user: User, access: Access) {
  const role = access.role;
  if (name === "draft_customer_message") {
    const type = clean(args.recordType, 20), id = clean(args.recordId, 100), channel = clean(args.channel, 20), body = clean(args.body, 4000);
    if (!["leads", "customers"].includes(type) || !id || !body || !["email", "whatsapp"].includes(channel)) return { ok: false, error: "A valid lead/customer, channel and message body are required." };
    const { data: row, error } = await admin.from("workspace_records").select("data").eq("workspace_id", workspaceId).eq("resource", type).eq("id", id).maybeSingle();
    if (error) throw error;
    if (!row) return { ok: false, error: "The selected contact record was not found." };
    const contact = obj(row.data), recipient = channel === "email" ? clean(contact.email, 180) : clean(contact.phone, 50);
    if (!recipient) return { ok: false, error: "The selected contact has no recipient address for this channel." };
    const consent = contact.consentToContact === true;
    const data = { recordType: type, recordId: id, contactName: clean(contact.name || contact.client || contact.title, 180), consentToContact: consent };
    const { data: inserted, error: insertError } = await admin.from("workspace_messages").insert({ workspace_id: workspaceId, channel, recipient, subject: channel === "email" ? clean(args.subject, 180) : "", body, status: "Pending approval", approval_status: "Pending", delivery_status: "Not sent", consent_to_contact: consent, data, created_by: user.id }).select("id").single();
    if (insertError) throw insertError;
    await audit(workspaceId, user.id, "ai_agent", "message_drafted", "messages", inserted.id, `Prepared a ${channel} draft for ${data.contactName}`);
    return { ok: true, action: "message_drafted", messageId: inserted.id, channel, recipient, status: "Pending approval", consentRecorded: true, deliveryStatus: "Not sent" };
  }
  if (name === "convert_lead_to_customer") {
    if (!roleCanWrite(role, "leads") || !roleCanWrite(role, "customers")) return { ok: false, error: "Your role cannot convert leads into customers." };
    const leadId = clean(args.leadId, 100);
    const { data: row, error } = await admin.from("workspace_records").select("data").eq("workspace_id", workspaceId).eq("resource", "leads").eq("id", leadId).maybeSingle();
    if (error) throw error;
    if (!row) return { ok: false, error: "Lead record not found." };
    const lead = obj(row.data), name = clean(lead.name || lead.client || lead.title, 180);
    if (lead.status === "Converted" || lead.convertedToCustomerId) return { ok: false, error: "This lead has already been converted." };
    if (!name) return { ok: false, error: "The lead has no name. Add the missing name before conversion." };
    const customer = await addRecord(workspaceId, "customers", { name, client: clean(lead.client, 180), email: clean(lead.email, 180), description: clean(lead.description, 2000), amount: Number(lead.amount || 0), status: "Active", sourceLeadId: leadId }, user.id);
    await updateRecord(workspaceId, "leads", leadId, { status: "Converted", convertedAt: new Date().toISOString(), convertedToCustomerId: customer.id });
    await audit(workspaceId, user.id, "ai_agent", "lead_converted", "leads", leadId, `Converted lead ${name} into customer ${customer.id}`);
    return { ok: true, action: "lead_converted", leadId, customerId: customer.id, customerName: name };
  }
  if (name === "create_workspace_record") {
    const resource = clean(args.resource, 30), fields = obj(args.fields);
    if (!validResource(resource) || !roleCanWrite(role, resource)) return { ok: false, error: "Your role cannot create this record." };
    const title = clean(fields.name || fields.title || fields.client, 180);
    if (!title) return { ok: false, error: "A name, title, or client is required." };
    if (["quotes", "invoices", "expenses", "payments"].includes(resource) && (typeof fields.amount !== "number" || !Number.isFinite(fields.amount))) return { ok: false, error: "An exact amount explicitly provided by the user is required for this financial record." };
    const record = await addRecord(workspaceId, resource, { ...fields, status: clean(fields.status, 40) || "Open" }, user.id);
    await audit(workspaceId, user.id, "ai_agent", "record_created", resource, record.id, `AI created ${resource} record ${title}`);
    return { ok: true, action: "record_created", resource, recordId: record.id, name: title };
  }
  if (name === "update_workspace_record") {
    const resource = clean(args.resource, 30), recordId = clean(args.recordId, 100), fields = obj(args.fields);
    if (!validResource(resource) || !roleCanWrite(role, resource)) return { ok: false, error: "Your role cannot update this record." };
    const allowed = ["name", "title", "client", "email", "phone", "company", "address", "source", "customerType", "customerId", "invoiceId", "paymentMethod", "reference", "paymentDate", "status", "description", "category", "dueDate", "amount"];
    const patch: Record<string, any> = {};
    for (const key of allowed) if (typeof fields[key] === "string" || (key === "amount" && typeof fields[key] === "number" && Number.isFinite(fields[key]))) patch[key] = fields[key];
    if (!Object.keys(patch).length) return { ok: false, error: "No valid changes were supplied." };
    await updateRecord(workspaceId, resource, recordId, patch);
    await audit(workspaceId, user.id, "ai_agent", "record_updated", resource, recordId, "AI updated workspace record");
    return { ok: true, action: "record_updated", resource, recordId, changedFields: Object.keys(patch) };
  }
  return { ok: false, error: "Unknown AI action." };
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const u = new URL(req.url);
    const route = u.searchParams.get("path") || "";
    if (!route.startsWith("/api/")) throw new HttpError("API route is missing or invalid.", 400);
    const parsed = new URL(route, "https://leadloop.local");
    const path = parsed.pathname;
    const method = req.method.toUpperCase();
    const publicMatch = path.match(/^\/api\/public\/enquiries\/([^/]+)$/);
    if (path === "/api/health" && method === "GET") return json({ ok: true, app: "LeadLoop SA" });
    if (publicMatch && ["GET", "POST"].includes(method)) {
      const token = decodeURIComponent(publicMatch[1]);
      const workspace = await tokenWorkspace(token);
      if (method === "GET") return json({ businessName: clean(workspace.name, 100) || "Business", industry: clean(workspace.industry, 80) });
      const b = obj(await bodyOf(req));
      if (clean(b.website, 200)) throw new HttpError("The enquiry could not be submitted.", 400);
      const name = clean(b.name), email = clean(b.email, 180).toLowerCase(), phone = clean(b.phone, 50);
      if (!name) throw new HttpError("Your name is required.");
      if (!email && !phone) throw new HttpError("Add an email address or phone number so the business can respond.");
      if (b.consent !== true) throw new HttpError("Please confirm that the business may contact you about this enquiry.");
      const lead = await addRecord(workspace.id, "leads", { name, email, phone, company: clean(b.company), serviceRequested: clean(b.serviceRequested), source: "Website enquiry", status: "New", description: clean(b.message, 2000), consentToContact: true, consentAt: new Date().toISOString() }, null);
      let taskCreated = false, taskId: string | undefined;
      try { const task = await addRecord(workspace.id, "tasks", { name: `Review new lead: ${name}`, title: `Review new lead: ${name}`, status: "Open", description: `Automatically prepared from public website enquiry ${lead.id}. Review the submitted details. No message has been sent and no due date or commitment has been assumed.`, sourceLeadId: lead.id, automationType: "new_lead_review" }, null); taskCreated = true; taskId = task.id; } catch (e) { console.error("task create failed", e); }
      return json({ submitted: true, leadId: lead.id, taskCreated, taskId, message: `Your enquiry has been sent to ${clean(workspace.name, 100)}.` }, 201);
    }

    const user = await userFrom(req);
    if (path === "/api/workspaces" && method === "GET") {
      const { data: memberships, error } = await admin.from("workspace_members").select("workspace_id,role").eq("user_id", user.id);
      if (error) throw error;
      const ids = (memberships || []).map(m => m.workspace_id);
      if (!ids.length) return json({ workspaces: [] });
      const { data: workspaces, error: wErr } = await admin.from("workspaces").select("*").in("id", ids);
      if (wErr) throw wErr;
      return json({ workspaces: (workspaces || []).map(w => profileOut(w, memberships.find(m => m.workspace_id === w.id)?.role || "employee")) });
    }
    if (path === "/api/workspaces" && method === "POST") {
      const b = obj(await bodyOf(req)), name = clean(b.name, 100);
      if (!name) throw new HttpError("Business name is required.");
      const now = new Date(), trialEnds = new Date(now.getTime() + 14 * 86400000).toISOString();
      const { data: workspace, error } = await admin.from("workspaces").insert({ name, industry: clean(b.industry, 80) || "Other", currency: "ZAR", created_by: user.id, trial_started_at: now.toISOString(), trial_ends_at: trialEnds }).select("*").single();
      if (error) throw error;
      const { error: mErr } = await admin.from("workspace_members").insert({ workspace_id: workspace.id, user_id: user.id, role: "owner", email: user.email || "" });
      if (mErr) { await admin.from("workspaces").delete().eq("id", workspace.id); throw mErr; }
      return json({ workspace: profileOut(workspace, "owner") }, 201);
    }
    const wsMatch = path.match(/^\/api\/workspaces\/([^/]+)(?:\/(.*))?$/);
    if (wsMatch) {
      const workspaceId = decodeURIComponent(wsMatch[1]), tail = wsMatch[2] || "";
      const access = await accessFor(user, workspaceId);
      if (tail === "overview" && method === "GET") {
        const names = ["leads", "customers", "projects", "tasks", "invoices"];
        const all = await Promise.all(names.map(n => listRecords(workspaceId, n)));
        const [leads, customers, projects, tasks, invoices] = all;
        const sum = (rows: any[]) => rows.reduce((v, r) => v + Number(r.amount || 0), 0);
        return json({ metrics: { leads: leads.length, customers: customers.length, projects: projects.filter(r => r.status !== "Done").length, tasks: tasks.filter(r => r.status !== "Done").length, revenue: sum(invoices.filter(r => r.status === "Paid")), outstanding: sum(invoices.filter(r => !["Paid", "Cancelled"].includes(r.status))) } });
      }
      if (tail === "members" && method === "GET") {
        const { data, error } = await admin.from("workspace_members").select("user_id,email,role,created_at").eq("workspace_id", workspaceId);
        if (error) throw error;
        return json({ items: (data || []).map(m => ({ userId: m.user_id, email: m.email, role: m.role, joinedAt: m.created_at })) });
      }
      if (tail === "invites" && method === "POST") {
        if (!canManage(access.role)) throw new HttpError("Only workspace owners and admins can invite employees.", 403);
        const b = obj(await bodyOf(req)), email = clean(b.email, 180).toLowerCase(), role = clean(b.role, 30);
        if (!email.includes("@")) throw new HttpError("A valid employee email is required.");
        if (!["employee", "manager", "finance", "admin"].includes(role)) throw new HttpError("Choose a valid employee role.");
        const code = randomCode(), codeHash = await sha(code);
        const { error } = await admin.from("workspace_invites").insert({ workspace_id: workspaceId, email, role, code_hash: codeHash, invited_by: user.id });
        if (error) throw error;
        return json({ code }, 201);
      }
      if (tail === "public-enquiry" && method === "GET") {
        if (!canManage(access.role)) throw new HttpError("Only workspace owners and admins can manage the public enquiry form.", 403);
        const { data: tokenRow, error } = await admin.from("public_enquiry_tokens").select("token_value").eq("workspace_id", workspaceId).is("revoked_at", null).maybeSingle();
        if (error) throw error;
        return json({ enabled: !!access.workspace.public_enquiry_enabled && !!tokenRow?.token_value, token: access.workspace.public_enquiry_enabled ? tokenRow?.token_value || null : null });
      }
      if (tail === "public-enquiry" && method === "POST") {
        if (!canManage(access.role)) throw new HttpError("Only workspace owners and admins can manage the public enquiry form.", 403);
        const enabled = obj(await bodyOf(req)).enabled === true;
        if (!enabled) {
          await admin.from("public_enquiry_tokens").update({ revoked_at: new Date().toISOString() }).eq("workspace_id", workspaceId).is("revoked_at", null);
          const { error } = await admin.from("workspaces").update({ public_enquiry_enabled: false, public_enquiry_token_hash: null, updated_at: new Date().toISOString() }).eq("id", workspaceId);
          if (error) throw error;
          return json({ enabled: false, token: null });
        }
        const token = randomCode(), hash = await sha(token);
        await admin.from("public_enquiry_tokens").update({ revoked_at: new Date().toISOString() }).eq("workspace_id", workspaceId).is("revoked_at", null);
        const { error: tokenErr } = await admin.from("public_enquiry_tokens").insert({ token_hash: hash, token_value: token, workspace_id: workspaceId });
        if (tokenErr) throw tokenErr;
        const { error } = await admin.from("workspaces").update({ public_enquiry_enabled: true, public_enquiry_token_hash: hash, updated_at: new Date().toISOString() }).eq("id", workspaceId);
        if (error) throw error;
        return json({ enabled: true, token });
      }
      if (tail === "integrations/whatsapp" && method === "GET") {
        const settings = obj(access.workspace.settings), connected = settings.whatsappConnectionStatus === "connected" && !!settings.whatsappBusinessAccountId;
        return json({ channel: "whatsapp", connected, status: connected ? "connected" : "not_connected", phoneDisplay: settings.whatsappPhoneDisplay || null, connectedAt: settings.whatsappConnectedAt || null, canStartEmbeddedSignup: false, message: connected ? "A WhatsApp account is recorded. Live handling still requires the approved Meta webhook and messaging services." : "Meta setup is not complete. The Meta developer app, permissions and webhook verification must be completed before businesses can connect their own accounts." });
      }
      if (tail === "messages" && method === "GET") return json({ items: await messageList(workspaceId) });
      const messageMatch = tail.match(/^messages\/([^/]+)\/(approve|mark-sent)$/);
      if (messageMatch && method === "POST") {
        if (!canManage(access.role)) throw new HttpError("Only workspace owners and admins can manage customer messages.", 403);
        const id = messageMatch[1], action = messageMatch[2];
        const { data: msg, error } = await admin.from("workspace_messages").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
        if (error) throw error;
        if (!msg) throw new HttpError("Message draft not found.", 404);
        const md = obj(msg.data);
        if (action === "approve") {
          if (msg.status !== "Pending approval") throw new HttpError("This message is no longer awaiting approval.", 409);
          if (!msg.consent_to_contact) throw new HttpError("Contact consent is not recorded. Do not approve or send this message.", 409);
          const { error: upErr } = await admin.from("workspace_messages").update({ status: "Approved - awaiting connection", approval_status: "Approved", approved_by: user.id, delivery_status: "Not sent - messaging connection not yet activated", updated_at: new Date().toISOString() }).eq("id", id).eq("workspace_id", workspaceId);
          if (upErr) throw upErr;
          await audit(workspaceId, user.id, "user", "message_approved", "messages", id, "Approved a customer message draft. It has not been sent.");
          return json({ approved: true, sent: false, status: "Approved - awaiting connection" });
        }
        if (msg.channel !== "email") throw new HttpError("Manual Gmail handoff is available for email messages only.");
        if (msg.approval_status !== "Approved" || msg.status !== "Approved - awaiting connection") throw new HttpError("Approve this email draft before marking it sent.", 409);
        if (!msg.consent_to_contact) throw new HttpError("Recorded contact consent is required.", 409);
        const status = "Sent (marked manually)", delivery = "Marked sent by user - not provider-verified";
        const { error: upErr } = await admin.from("workspace_messages").update({ status, delivery_status: delivery, updated_at: new Date().toISOString(), data: { ...md, manuallyMarkedSentBy: user.id, manuallyMarkedSentAt: new Date().toISOString() } }).eq("id", id).eq("workspace_id", workspaceId);
        if (upErr) throw upErr;
        await audit(workspaceId, user.id, "user", "message_marked_sent_manually", "messages", id, "User marked an approved email as sent manually. Provider delivery was not verified.");
        return json({ updated: true, status, deliveryStatus: delivery, verified: false });
      }
      if (tail === "assistant" && method === "GET") {
        const question = clean(parsed.searchParams.get("question"), 1500);
        if (!question) throw new HttpError("Ask a question first.");
        return json(await handleAI(workspaceId, user, access, question));
      }
      const resourceGet = tail.match(/^([a-z-]+)$/);
      if (resourceGet && method === "GET") {
        const resource = resourceGet[1];
        if (!validResource(resource)) throw new HttpError("Unknown workspace resource.", 404);
        return json({ items: await listRecords(workspaceId, resource) });
      }
      const resourcePost = tail.match(/^([a-z-]+)$/);
      if (resourcePost && method === "POST") {
        const resource = resourcePost[1];
        if (!validResource(resource)) throw new HttpError("Unknown workspace resource.", 404);
        if (!roleCanWrite(access.role, resource)) throw new HttpError("Your role cannot create records in this section.", 403);
        const b = obj(await bodyOf(req)), title = clean(b.name || b.title || b.client || b.description, 180);
        if (!title) throw new HttpError("A name or title is required.");
        let startAt = "", endAt = "";
        if (resource === "appointments") {
          const start = new Date(clean(b.startAt, 80)), end = new Date(clean(b.endAt, 80));
          if (!clean(b.name || b.title, 180) || !clean(b.startAt, 80) || !clean(b.endAt, 80) || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new HttpError("Choose a valid start and end time. The end must be after the start.");
          startAt = start.toISOString(); endAt = end.toISOString();
          const existing = await listRecords(workspaceId, "appointments"), assignedTo = clean(b.assignedTo, 120);
          const conflict = existing.find(item => {
            if (["Cancelled", "Completed"].includes(item.status)) return false;
            if (assignedTo && clean(item.assignedTo, 120) && clean(item.assignedTo, 120) !== assignedTo) return false;
            const a = new Date(String(item.startAt || "")).getTime(), z = new Date(String(item.endAt || "")).getTime();
            return Number.isFinite(a) && Number.isFinite(z) && start.getTime() < z && end.getTime() > a;
          });
          if (conflict) throw new HttpError("That time overlaps an existing appointment. Choose another time or assign a different staff member.", 409);
        }
        const record = { ...b, name: clean(b.name), title: clean(b.title), client: clean(b.client), email: clean(b.email), phone: clean(b.phone, 50), company: clean(b.company), address: clean(b.address, 500), source: clean(b.source, 100), customerType: clean(b.customerType, 50), customerId: clean(b.customerId, 100), invoiceId: clean(b.invoiceId, 100), paymentMethod: clean(b.paymentMethod, 80), reference: clean(b.reference, 120), paymentDate: clean(b.paymentDate, 40), amount: Number.isFinite(Number(b.amount)) ? Number(b.amount) : 0, status: clean(b.status, 40) || "Open", description: clean(b.description, 2000), category: clean(b.category, 80), dueDate: clean(b.dueDate, 40), service: clean(b.service, 180), assignedTo: clean(b.assignedTo, 120), location: clean(b.location, 500), startAt, endAt };
        const item = await addRecord(workspaceId, resource, record, user.id);
        let automation: any;
        if (resource === "leads") {
          try { const task = await addRecord(workspaceId, "tasks", { name: `Review new lead: ${clean(record.name || record.client || record.title)}`, title: `Review new lead: ${clean(record.name || record.client || record.title)}`, status: "Open", description: `Automatically prepared from lead record ${item.id}. Review the information already recorded. No customer message has been sent.`, sourceLeadId: item.id, automationType: "new_lead_review" }, user.id); automation = { taskCreated: true, taskId: task.id, message: "A linked lead-review task was created automatically." }; } catch { automation = { taskCreated: false, message: "The lead was saved, but its review task could not be created." }; }
        }
        return json({ item, automation }, 201);
      }
      const resourcePut = tail.match(/^([a-z-]+)\/([^/]+)$/);
      if (resourcePut && method === "PUT") {
        const resource = resourcePut[1], id = decodeURIComponent(resourcePut[2]);
        if (!validResource(resource)) throw new HttpError("Unknown workspace resource.", 404);
        if (!roleCanWrite(access.role, resource)) throw new HttpError("Your role cannot update records in this section.", 403);
        const b = obj(await bodyOf(req)), patch: any = {};
        if (typeof b.status === "string") patch.status = clean(b.status, 40);
        if (typeof b.description === "string") patch.description = clean(b.description, 2000);
        await updateRecord(workspaceId, resource, id, patch);
        return json({ updated: true });
      }
    }
    if (path.match(/^\/api\/invites\/[^/]+\/join$/) && method === "POST") {
      const code = decodeURIComponent(path.split("/")[3] || ""), hash = await sha(code);
      const { data: invite, error } = await admin.from("workspace_invites").select("*").eq("code_hash", hash).maybeSingle();
      if (error) throw error;
      if (!invite || invite.accepted_at || new Date(invite.expires_at).getTime() < Date.now()) throw new HttpError("This invitation is invalid, expired or already used.", 400);
      if (!user.email || user.email.toLowerCase() !== invite.email.toLowerCase()) throw new HttpError("Sign in using the email address this invitation was sent to.", 403);
      const { error: mErr } = await admin.from("workspace_members").upsert({ workspace_id: invite.workspace_id, user_id: user.id, role: invite.role, email: user.email }, { onConflict: "workspace_id,user_id" });
      if (mErr) throw mErr;
      const { error: iErr } = await admin.from("workspace_invites").update({ accepted_at: new Date().toISOString() }).eq("id", invite.id).is("accepted_at", null);
      if (iErr) throw iErr;
      return json({ joined: true, workspaceId: invite.workspace_id, role: invite.role });
    }
    throw new HttpError("API route not found.", 404);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error("LeadLoop API error", error);
    return json({ error: "LeadLoop could not complete this request. Please retry." }, 500);
  }
});
