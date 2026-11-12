import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-leadloop-webhook-secret, x-hub-signature-256",
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
async function listRecords(workspaceId: string, resource: string): Promise<Array<Record<string, any>>> {
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

async function publicEnquiryUrlForWorkspace(workspaceId: string) {
  const { data: workspace, error: workspaceError } = await admin.from("workspaces").select("public_enquiry_enabled,settings").eq("id", workspaceId).maybeSingle();
  if (workspaceError) throw workspaceError;
  if (!workspace?.public_enquiry_enabled) return null;
  const { data: tokenRow, error: tokenError } = await admin.from("public_enquiry_tokens").select("token_value").eq("workspace_id", workspaceId).is("revoked_at", null).maybeSingle();
  if (tokenError) throw tokenError;
  const settings = obj(workspace.settings);
  const baseUrl = clean(settings.publicAppUrl || Deno.env.get("LEADLOOP_PUBLIC_APP_URL"), 500).replace(/\/+$/, "");
  if (!baseUrl || !tokenRow?.token_value) return null;
  return baseUrl + "/#/enquiry/" + tokenRow.token_value;
}

async function createMissedCallAIDraft(workspaceName: string, callerPhone: string, enquiryUrl: string) {
  const key = Deno.env.get("AI_PROVIDER_API_KEY");
  if (!key) throw new HttpError("AI_PROVIDER_API_KEY is not configured for LeadLoop.", 503);
  const prompt = "Write a concise, friendly WhatsApp follow-up for a business that missed a customer's phone call. Say the business noticed the missed call, invite the person to explain what they need using the enquiry link, and do not claim anyone has called them back or booked anything. Include this exact link unchanged: " + enquiryUrl + ". Keep it under 500 characters.";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You write honest, helpful customer-service WhatsApp drafts for South African small businesses. Never invent facts, offers, availability or promises. Return only the message text." },
        { role: "user", content: "Business: " + clean(workspaceName, 100) + "\nCaller number: " + clean(callerPhone, 50) + "\n" + prompt }
      ],
      temperature: 0.4,
      max_tokens: 220
    })
  });
  if (!response.ok) throw new HttpError("The AI provider could not draft the missed-call reply. Check the AI key and provider account.", 503);
  const payload = await response.json();
  let body = clean(payload.choices?.[0]?.message?.content, 1200);
  if (!body) throw new HttpError("The AI provider returned an empty missed-call draft.", 503);
  if (!body.includes(enquiryUrl)) body = body.trim() + "\n\nEnquiry form: " + enquiryUrl;
  return body.slice(0, 1500);
}

async function listMissedCalls(workspaceId: string) {
  const { data: calls, error } = await admin.from("workspace_missed_calls").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  const ids = (calls || []).map(c => c.message_id).filter(Boolean);
  let messages: any[] = [];
  if (ids.length) {
    const { data, error: messageError } = await admin.from("workspace_messages").select("id,body,status,approval_status,delivery_status").in("id", ids);
    if (messageError) throw messageError;
    messages = data || [];
  }
  const byId = new Map(messages.map(m => [m.id, m]));
  return (calls || []).map(call => {
    const message = call.message_id ? byId.get(call.message_id) : null;
    const digits = clean(call.caller_phone, 50).replace(/[^0-9]/g, "");
    return {
      ...call,
      draft: message?.body || null,
      messageStatus: message?.status || null,
      deliveryStatus: message?.delivery_status || null,
      whatsappUrl: call.contact_permission === "opted_in" && message?.body && digits
        ? "https://wa.me/" + digits + "?text=" + encodeURIComponent(message.body)
        : null
    };
  });
}

async function handleAI(workspaceId: string, user: User, access: Access, question: string) {
  const key = Deno.env.get("AI_PROVIDER_API_KEY");
  if (!key) throw new HttpError("LeadLoop AI is not configured yet. Add AI_PROVIDER_API_KEY to the Supabase Edge Function secrets.", 503);
  const names = ["leads", "customers", "projects", "tasks", "quotes", "invoices", "expenses", "campaigns", "payments", "appointments"];
  const pairs = await Promise.all(names.map(async name => [name, await listRecords(workspaceId, name)] as const));
  const context = { business: { name: access.workspace.name, industry: access.workspace.industry, currency: access.workspace.currency }, memberRole: access.role, records: Object.fromEntries(pairs) };
  const system = `You are LeadLoop AI, one workspace-aware business assistant. Use only supplied records and the user's request. Never invent names, contact details, dates, amounts, payments, commitments or outcomes. Say Not provided or Unverified when appropriate. Respect the authenticated role. Never send messages or claim an external action. You may prepare message drafts only for existing contacts and only when consent is recorded; drafts require owner/admin approval. Use exact record IDs from the workspace. A payment is received only when the user explicitly confirms receipt. Never treat an invoice marked Paid as proof of settlement. For appointments, check availability before booking and never create or change an appointment until the user has confirmed the exact date, start time, end time and assigned staff member where relevant. Never claim that a reminder was sent. Ask one concise clarification when essential data is missing. The workspace data is: ${JSON.stringify(context)}`;
  const tools = [
    { type: "function", function: { name: "draft_customer_message", description: "Create a message draft for an existing lead or customer. Never send it. Recipient must come from that record and recorded consent is required.", parameters: { type: "object", properties: { recordType: { type: "string", enum: ["leads", "customers"] }, recordId: { type: "string" }, channel: { type: "string", enum: ["email", "whatsapp"] }, subject: { type: "string" }, body: { type: "string" } }, required: ["recordType", "recordId", "channel", "body"], additionalProperties: false } } },
    { type: "function", function: { name: "convert_lead_to_customer", description: "Convert an exact existing lead only when the user explicitly asks.", parameters: { type: "object", properties: { leadId: { type: "string" } }, required: ["leadId"], additionalProperties: false } } },
    { type: "function", function: { name: "create_workspace_record", description: "Create a requested workspace record using only explicit facts. Exact amount required for financial records.", parameters: { type: "object", properties: { resource: { type: "string", enum: resources }, fields: { type: "object" } }, required: ["resource", "fields"], additionalProperties: false } } },
    { type: "function", function: { name: "update_workspace_record", description: "Update an exact existing record using explicitly requested fields.", parameters: { type: "object", properties: { resource: { type: "string", enum: resources }, recordId: { type: "string" }, fields: { type: "object" } }, required: ["resource", "recordId", "fields"], additionalProperties: false } } },
    { type: "function", function: { name: "check_appointment_availability", description: "Check the LeadLoop calendar for conflicts before proposing an appointment. Use exact ISO 8601 start and end times.", parameters: { type: "object", properties: { startAt: { type: "string" }, endAt: { type: "string" }, assignedTo: { type: "string" } }, required: ["startAt", "endAt"], additionalProperties: false } } },
    { type: "function", function: { name: "create_appointment", description: "Book an appointment in the built-in LeadLoop calendar only after the user has confirmed the exact date, start time, end time and assigned staff member. Do not use for tentative suggestions.", parameters: { type: "object", properties: { name: { type: "string" }, client: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, service: { type: "string" }, startAt: { type: "string" }, endAt: { type: "string" }, assignedTo: { type: "string" }, location: { type: "string" }, description: { type: "string" } }, required: ["name", "startAt", "endAt"], additionalProperties: false } } },
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
  if (name === "check_appointment_availability") {
    const startText = clean(args.startAt, 80), endText = clean(args.endAt, 80);
    const start = new Date(startText), end = new Date(endText);
    if (!startText || !endText || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return { ok: false, error: "A valid start and end time are required." };
    const assignedTo = clean(args.assignedTo, 120);
    const appointments = await listRecords(workspaceId, "appointments");
    const conflicts = appointments.filter(item => {
      if (["Cancelled", "Completed"].includes(String(item.status || ""))) return false;
      if (assignedTo && clean(item.assignedTo, 120) && clean(item.assignedTo, 120) !== assignedTo) return false;
      const a = new Date(String(item.startAt || "")).getTime(), b = new Date(String(item.endAt || "")).getTime();
      return Number.isFinite(a) && Number.isFinite(b) && start.getTime() < b && end.getTime() > a;
    });
    return { ok: true, available: conflicts.length === 0, conflicts: conflicts.map(item => ({ id: item.id, name: item.name, startAt: item.startAt, endAt: item.endAt, assignedTo: item.assignedTo })) };
  }
  if (name === "create_appointment") {
    if (!roleCanWrite(role, "appointments")) return { ok: false, error: "Your role cannot create appointments." };
    const title = clean(args.name, 180), startText = clean(args.startAt, 80), endText = clean(args.endAt, 80);
    const start = new Date(startText), end = new Date(endText);
    if (!title || !startText || !endText || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return { ok: false, error: "A name and valid start/end times are required." };
    const assignedTo = clean(args.assignedTo, 120);
    const existing = await listRecords(workspaceId, "appointments");
    const conflict = existing.find(item => {
      if (["Cancelled", "Completed"].includes(String(item.status || ""))) return false;
      if (assignedTo && clean(item.assignedTo, 120) && clean(item.assignedTo, 120) !== assignedTo) return false;
      const a = new Date(String(item.startAt || "")).getTime(), b = new Date(String(item.endAt || "")).getTime();
      return Number.isFinite(a) && Number.isFinite(b) && start.getTime() < b && end.getTime() > a;
    });
    if (conflict) return { ok: false, error: "That time conflicts with an existing appointment. Offer another available time." };
    const record = await addRecord(workspaceId, "appointments", { name: title, title, client: clean(args.client, 180), email: clean(args.email, 180), phone: clean(args.phone, 50), service: clean(args.service, 180), startAt: start.toISOString(), endAt: end.toISOString(), assignedTo, location: clean(args.location, 500), description: clean(args.description, 2000), status: "Confirmed" }, user.id);
    await audit(workspaceId, user.id, "ai_agent", "appointment_created", "appointments", record.id, "Booked appointment " + title);
    return { ok: true, action: "appointment_created", appointmentId: record.id, name: title, startAt: start.toISOString(), endAt: end.toISOString(), assignedTo, status: "Confirmed" };
  }
  if (name === "draft_customer_message") {
    const type = clean(args.recordType, 20), id = clean(args.recordId, 100), channel = clean(args.channel, 20), body = clean(args.body, 4000);
    if (!["leads", "customers"].includes(type) || !id || !body || !["email", "whatsapp"].includes(channel)) return { ok: false, error: "A valid lead/customer, channel and message body are required." };
    const { data: row, error } = await admin.from("workspace_records").select("data").eq("workspace_id", workspaceId).eq("resource", type).eq("id", id).maybeSingle();
    if (error) throw error;
    if (!row) return { ok: false, error: "The selected contact record was not found." };
    const contact = obj(row.data), recipient = channel === "email" ? clean(contact.email, 180) : clean(contact.phone, 50);
    if (!recipient) return { ok: false, error: "The selected contact has no recipient address for this channel." };
    const consent = contact.consentToContact === true;
    if (!consent) return { ok: false, error: "Recorded contact consent is required before drafting a customer message." };
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


    if (path === "/api/webhooks/missed-call" && method === "POST") {
      const b = obj(await bodyOf(req));
      const workspaceId = clean(b.workspaceId, 80);
      const providerCallId = clean(b.providerCallId || b.callId, 200);
      const callerPhone = clean(b.callerPhone || b.from, 50).replace(/[^0-9+]/g, "");
      const suppliedSecret = req.headers.get("x-leadloop-webhook-secret") || "";
      if (!workspaceId || !providerCallId || callerPhone.replace(/\D/g, "").length < 8 || !suppliedSecret)
        throw new HttpError("Workspace, call ID, caller number and webhook secret are required.", 400);
      const { data: integration, error: integrationError } = await admin.from("workspace_call_integrations").select("*").eq("workspace_id", workspaceId).maybeSingle();
      if (integrationError) throw integrationError;
      const settings = obj(integration?.settings);
      if (!integration || !settings.webhook_secret_hash || await sha(suppliedSecret) !== settings.webhook_secret_hash)
        throw new HttpError("Invalid missed-call webhook credentials.", 401);
      const callOutcome = ["missed", "no_answer", "busy", "cancelled"].includes(clean(b.callOutcome, 30)) ? clean(b.callOutcome, 30) : "missed";
      if (callOutcome === "cancelled") return json({ recorded: false, ignored: true, reason: "Call was cancelled." });
      const provider = clean(b.provider, 40) || integration.provider || "webhook";
      const { data: existing, error: existingError } = await admin.from("workspace_missed_calls").select("id,follow_up_status,message_id").eq("workspace_id", workspaceId).eq("provider", provider).eq("provider_call_id", providerCallId).maybeSingle();
      if (existingError) throw existingError;
      if (existing) return json({ recorded: true, duplicate: true, missedCallId: existing.id, followUpStatus: existing.follow_up_status });
      const { data: workspace, error: workspaceError } = await admin.from("workspaces").select("name").eq("id", workspaceId).maybeSingle();
      if (workspaceError) throw workspaceError;
      if (!workspace) throw new HttpError("Workspace not found.", 404);
      const { data: call, error: insertError } = await admin.from("workspace_missed_calls").insert({
        workspace_id: workspaceId,
        provider,
        provider_call_id: providerCallId,
        caller_phone: callerPhone,
        business_phone: clean(b.businessPhone || b.to || integration.business_phone_number, 50),
        call_started_at: b.callStartedAt && Number.isFinite(new Date(b.callStartedAt).getTime()) ? new Date(b.callStartedAt).toISOString() : null,
        call_ended_at: b.callEndedAt && Number.isFinite(new Date(b.callEndedAt).getTime()) ? new Date(b.callEndedAt).toISOString() : null,
        call_outcome: callOutcome,
        follow_up_status: "new",
        contact_permission: "unknown",
        metadata: { source: "authenticated_missed_call_webhook" }
      }).select("*").single();
      if (insertError) throw insertError;
      let enquiryUrl: string | null = null;
      try { enquiryUrl = await publicEnquiryUrlForWorkspace(workspaceId); } catch (e) { console.error("Missed-call enquiry link lookup failed", e); }
      if (!enquiryUrl) {
        await admin.from("workspace_missed_calls").update({ failure_reason: "The public enquiry form is not enabled or LEADLOOP_PUBLIC_APP_URL is not configured." }).eq("id", call.id);
        return json({ recorded: true, draftCreated: false, missedCallId: call.id, reason: "Enable the public enquiry form and configure the public app URL to draft a reply." }, 201);
      }
      try {
        const draft = await createMissedCallAIDraft(workspace.name, callerPhone, enquiryUrl);
        const { data: message, error: messageError } = await admin.from("workspace_messages").insert({
          workspace_id: workspaceId,
          channel: "whatsapp",
          recipient: callerPhone,
          subject: "",
          body: draft,
          status: "Pending approval",
          approval_status: "Pending",
          delivery_status: "Not sent - WhatsApp consent has not been recorded",
          consent_to_contact: false,
          data: { direction: "outbound_draft", source: "missed_call_ai", missedCallId: call.id, enquiryUrl, contactPermission: "unknown" }
        }).select("id").single();
        if (messageError) throw messageError;
        await admin.from("workspace_missed_calls").update({ follow_up_status: "drafted", enquiry_url: enquiryUrl, message_id: message.id, failure_reason: null, updated_at: new Date().toISOString() }).eq("id", call.id);
        await audit(workspaceId, "leadloop-ai", "ai_agent", "missed_call_reply_drafted", "missed_calls", call.id, "AI drafted a WhatsApp missed-call follow-up. It was not sent because contact permission is unknown.");
        return json({ recorded: true, draftCreated: true, autoSent: false, contactPermission: "unknown", missedCallId: call.id, messageId: message.id }, 201);
      } catch (draftError) {
        const reason = draftError instanceof Error ? draftError.message : "AI draft generation failed.";
        await admin.from("workspace_missed_calls").update({ failure_reason: reason, updated_at: new Date().toISOString() }).eq("id", call.id);
        return json({ recorded: true, draftCreated: false, missedCallId: call.id, reason }, 201);
      }
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
        return json({ metrics: { leads: leads.length, customers: customers.length, projects: projects.filter(r => !["Done", "Cancelled"].includes(r.status)).length, tasks: tasks.filter(r => !["Done", "Cancelled"].includes(r.status)).length, revenue: sum(invoices.filter(r => r.status === "Paid")), outstanding: sum(invoices.filter(r => !["Paid", "Cancelled"].includes(r.status))) } });
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
        const body = obj(await bodyOf(req));
        const enabled = body.enabled === true;
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
        const origin = req.headers.get("origin") || "";
        let publicAppUrl = "";
        try {
          const parsedOrigin = new URL(origin);
          if (parsedOrigin.protocol === "https:" || parsedOrigin.hostname === "localhost") publicAppUrl = parsedOrigin.origin;
        } catch { /* No browser origin supplied. */ }
        const nextSettings = publicAppUrl ? { ...obj(access.workspace.settings), publicAppUrl } : obj(access.workspace.settings);
        const { error } = await admin.from("workspaces").update({ public_enquiry_enabled: true, public_enquiry_token_hash: hash, settings: nextSettings, updated_at: new Date().toISOString() }).eq("id", workspaceId);
        if (error) throw error;
        return json({ enabled: true, token, publicUrl: publicAppUrl ? publicAppUrl + "/#/enquiry/" + token : null });
      }

      if (tail === "integrations/calls" && method === "GET") {
        const { data: integration, error } = await admin.from("workspace_call_integrations").select("provider,business_phone_number,connection_status,provider_account_ref,updated_at").eq("workspace_id", workspaceId).maybeSingle();
        if (error) throw error;
        return json({ configured: !!integration, integration: integration || null });
      }
      if (tail === "integrations/calls" && method === "POST") {
        if (!canManage(access.role)) throw new HttpError("Only workspace owners and admins can configure missed-call capture.", 403);
        const b = obj(await bodyOf(req));
        const secret = randomCode() + randomCode();
        const current = await admin.from("workspace_call_integrations").select("settings").eq("workspace_id", workspaceId).maybeSingle();
        if (current.error) throw current.error;
        const settings = { ...obj(current.data?.settings), webhook_secret_hash: await sha(secret), webhook_secret_created_at: new Date().toISOString() };
        const { error } = await admin.from("workspace_call_integrations").upsert({
          workspace_id: workspaceId,
          provider: "webhook",
          business_phone_number: clean(b.businessPhoneNumber, 50) || null,
          connection_status: "pending",
          settings,
          updated_at: new Date().toISOString()
        }, { onConflict: "workspace_id" });
        if (error) throw error;
        const webhookUrl = url.replace(/\/$/, "") + "/functions/v1/leadloop-api?path=" + encodeURIComponent("/api/webhooks/missed-call");
        await audit(workspaceId, user.id, "user", "missed_call_webhook_created", "call_integrations", workspaceId, "Created a private missed-call webhook endpoint.");
        return json({ configured: true, provider: "webhook", webhookUrl, secret, headerName: "x-leadloop-webhook-secret", requiredFields: ["workspaceId", "providerCallId", "callerPhone"], warning: "The secret is shown once. Store it in the phone/call provider's secure webhook configuration. This endpoint records missed calls but does not detect calls by itself." }, 201);
      }
      if (tail === "missed-calls" && method === "GET") {
        return json({ items: await listMissedCalls(workspaceId) });
      }
      const permissionMatch = tail.match(/^missed-calls\/([^/]+)\/permission$/);
      if (permissionMatch && method === "POST") {
        if (!["owner", "admin", "manager"].includes(access.role)) throw new HttpError("Your role cannot update customer contact permission.", 403);
        const id = decodeURIComponent(permissionMatch[1]), b = obj(await bodyOf(req));
        const permission = clean(b.permission, 30), evidence = clean(b.evidence, 500);
        if (!["opted_in", "opted_out", "unknown"].includes(permission)) throw new HttpError("Choose opted_in, opted_out or unknown.", 400);
        if (permission === "opted_in" && evidence.length < 10) throw new HttpError("Record how the customer explicitly agreed to WhatsApp contact before marking them opted in.", 400);
        const { data: call, error: callError } = await admin.from("workspace_missed_calls").select("id,message_id").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
        if (callError) throw callError;
        if (!call) throw new HttpError("Missed call not found.", 404);
        const { error: updateError } = await admin.from("workspace_missed_calls").update({
          contact_permission: permission,
          contact_permission_evidence: permission === "opted_in" ? evidence : null,
          contact_permission_recorded_by: user.id,
          contact_permission_recorded_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }).eq("workspace_id", workspaceId).eq("id", id);
        if (updateError) throw updateError;
        if (call.message_id) {
          const { data: message, error: messageReadError } = await admin.from("workspace_messages").select("data").eq("workspace_id", workspaceId).eq("id", call.message_id).maybeSingle();
          if (messageReadError) throw messageReadError;
          const { error: messageUpdateError } = await admin.from("workspace_messages").update({
            consent_to_contact: permission === "opted_in",
            data: { ...obj(message?.data), contactPermission: permission, contactPermissionEvidence: permission === "opted_in" ? evidence : null, contactPermissionRecordedBy: user.id, contactPermissionRecordedAt: new Date().toISOString() },
            delivery_status: permission === "opted_in" ? "Not sent - awaiting owner/admin approval" : "Not sent - customer WhatsApp permission not confirmed"
          }).eq("workspace_id", workspaceId).eq("id", call.message_id);
          if (messageUpdateError) throw messageUpdateError;
        }
        await audit(workspaceId, user.id, "user", "missed_call_contact_permission_updated", "missed_calls", id, "Updated customer WhatsApp contact permission to " + permission + ".");
        return json({ updated: true, permission, canApproveDraft: permission === "opted_in" });
      }


      if (tail === "integrations/whatsapp" && method === "GET") {
        const { data: account, error: accountError } = await admin.from("workspace_whatsapp_accounts").select("waba_id,phone_number_id,display_phone_number,business_name,connection_status,connected_at,access_token_expires_at,last_error").eq("workspace_id", workspaceId).maybeSingle();
        if (accountError) throw accountError;
        const configured = !!Deno.env.get("META_APP_ID") && !!Deno.env.get("META_CONFIG_ID") && !!Deno.env.get("META_APP_SECRET");
        return json({
          channel: "whatsapp",
          connected: account?.connection_status === "connected",
          status: account?.connection_status || "not_connected",
          phoneDisplay: account?.display_phone_number || null,
          businessName: account?.business_name || null,
          connectedAt: account?.connected_at || null,
          canStartEmbeddedSignup: configured,
          metaConfigured: configured,
          message: configured
            ? (account?.connection_status === "connected" ? "WhatsApp Business is connected. Inbound webhook subscription and approved message templates still need to be verified." : "Meta credentials are configured. Complete the WhatsApp Embedded Signup flow to connect this business's own number.")
            : "Meta setup is still required. Configure META_APP_ID, META_APP_SECRET and META_CONFIG_ID in Supabase Edge Function secrets before businesses can connect their own WhatsApp Business accounts."
        });
      }
      if (tail === "integrations/whatsapp/config" && method === "GET") {
        if (!canManage(access.role)) throw new HttpError("Only workspace owners and admins can connect WhatsApp.", 403);
        const appId = Deno.env.get("META_APP_ID") || "";
        const configId = Deno.env.get("META_CONFIG_ID") || "";
        return json({ configured: !!(appId && configId && Deno.env.get("META_APP_SECRET")), appId, configId, graphApiVersion: Deno.env.get("META_GRAPH_API_VERSION") || "v24.0" });
      }
      if (tail === "integrations/whatsapp/exchange" && method === "POST") {
        if (!canManage(access.role)) throw new HttpError("Only workspace owners and admins can connect WhatsApp.", 403);
        const b = obj(await bodyOf(req));
        const code = clean(b.code, 4000), wabaId = clean(b.wabaId, 100), phoneNumberId = clean(b.phoneNumberId, 100);
        const appId = Deno.env.get("META_APP_ID"), appSecret = Deno.env.get("META_APP_SECRET");
        const apiVersion = Deno.env.get("META_GRAPH_API_VERSION") || "v24.0";
        if (!appId || !appSecret) throw new HttpError("Meta app credentials are not configured in Supabase Edge Function secrets.", 503);
        if (!code || !wabaId || !phoneNumberId) throw new HttpError("Meta authorization code, WhatsApp Business Account ID and phone number ID are required.", 400);
        const tokenUrl = new URL("https://graph.facebook.com/" + apiVersion + "/oauth/access_token");
        tokenUrl.searchParams.set("client_id", appId);
        tokenUrl.searchParams.set("client_secret", appSecret);
        tokenUrl.searchParams.set("code", code);
        if (b.redirectUri) tokenUrl.searchParams.set("redirect_uri", clean(b.redirectUri, 1000));
        const tokenResponse = await fetch(tokenUrl.toString());
        const tokenPayload = await tokenResponse.json();
        if (!tokenResponse.ok || !tokenPayload.access_token) throw new HttpError("Meta could not exchange the signup code. Check the Meta app configuration and redirect URI.", 400);
        const accessToken = String(tokenPayload.access_token);
        const phoneUrl = new URL("https://graph.facebook.com/" + apiVersion + "/" + encodeURIComponent(phoneNumberId));
        phoneUrl.searchParams.set("fields", "display_phone_number,verified_name,whatsapp_business_account");
        phoneUrl.searchParams.set("access_token", accessToken);
        const phoneResponse = await fetch(phoneUrl.toString());
        const phonePayload = await phoneResponse.json();
        if (!phoneResponse.ok) throw new HttpError("Meta did not verify the selected WhatsApp phone number. Check that the Embedded Signup result belongs to this business.", 400);
        const verifiedWaba = clean(phonePayload.whatsapp_business_account?.id, 100);
        if (verifiedWaba && verifiedWaba !== wabaId) throw new HttpError("The phone number does not belong to the selected WhatsApp Business Account.", 403);
        const { data: secretRef, error: secretError } = await admin.rpc("store_workspace_whatsapp_token", { p_workspace_id: workspaceId, p_access_token: accessToken });
        if (secretError) throw new HttpError("WhatsApp token could not be stored securely in Supabase Vault.", 500);
        const expiresAt = Number(tokenPayload.expires_in) > 0 ? new Date(Date.now() + Number(tokenPayload.expires_in) * 1000).toISOString() : null;
        const { error: saveError } = await admin.from("workspace_whatsapp_accounts").upsert({
          workspace_id: workspaceId,
          waba_id: wabaId,
          phone_number_id: phoneNumberId,
          display_phone_number: clean(phonePayload.display_phone_number, 50),
          business_name: clean(phonePayload.verified_name, 180),
          connection_status: "connected",
          token_secret_ref: secretRef,
          access_token_expires_at: expiresAt,
          connected_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString()
        }, { onConflict: "workspace_id" });
        if (saveError) throw saveError;
        await audit(workspaceId, user.id, "user", "whatsapp_business_connected", "integrations", workspaceId, "Connected a customer-owned WhatsApp Business account.");
        return json({ connected: true, phoneDisplay: clean(phonePayload.display_phone_number, 50), businessName: clean(phonePayload.verified_name, 180), expiresAt });
      }

      if (tail === "messages" && method === "GET") return json({ items: await messageList(workspaceId) });
      if (tail === "messages/drafts" && method === "POST") {
        const b = obj(await bodyOf(req)), recordId = clean(b.recordId, 100);
        if (clean(b.recordType, 20) !== "leads" || !recordId || clean(b.channel, 20) !== "email") throw new HttpError("Only an email draft for an existing lead can be prepared by this agent.");
        const { data: leadRow, error: leadError } = await admin.from("workspace_records").select("data").eq("workspace_id", workspaceId).eq("resource", "leads").eq("id", recordId).maybeSingle();
        if (leadError) throw leadError;
        if (!leadRow) throw new HttpError("The selected lead no longer exists.", 404);
        const lead = obj(leadRow.data), recipient = clean(lead.email, 180), body = clean(b.body, 4000);
        if (!recipient || !body) throw new HttpError("A valid lead email address and message body are required.");
        if (lead.consentToContact !== true) throw new HttpError("Recorded contact consent is required. No draft was saved.", 409);
        const { data: inserted, error: insertError } = await admin.from("workspace_messages").insert({ workspace_id: workspaceId, channel: "email", recipient, subject: clean(b.subject, 180), body, status: "Pending approval", approval_status: "Pending", delivery_status: "Not sent", consent_to_contact: true, data: { recordType: "leads", recordId, contactName: clean(lead.name || lead.client || lead.title, 180), consentToContact: true, source: "rule_based_leadloop_agent" }, created_by: user.id }).select("id").single();
        if (insertError) throw insertError;
        await audit(workspaceId, user.id, "rule_based_agent", "message_drafted", "messages", inserted.id, "Prepared an email draft for approval. Not sent.");
        return json({ created: true, messageId: inserted.id, status: "Pending approval", sent: false, message: "Draft saved in Messages for owner/admin approval. It has NOT been sent." }, 201);
      }
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
        if (resource === "appointments") {
          const existing = (await listRecords(workspaceId, "appointments")).find(item => item.id === id);
          if (!existing) throw new HttpError("Appointment not found.", 404);
          const startText = clean(b.startAt || existing.startAt, 80), endText = clean(b.endAt || existing.endAt, 80);
          const start = new Date(startText), end = new Date(endText);
          if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new HttpError("Choose a valid start and end time. The end must be after the start.");
          const assignedTo = typeof b.assignedTo === "string" ? clean(b.assignedTo, 120) : clean(existing.assignedTo, 120);
          const conflict = (await listRecords(workspaceId, "appointments")).find(item => {
            if (item.id === id || ["Cancelled", "Completed"].includes(String(item.status || ""))) return false;
            if (assignedTo && clean(item.assignedTo, 120) && clean(item.assignedTo, 120) !== assignedTo) return false;
            const a = new Date(String(item.startAt || "")).getTime(), z = new Date(String(item.endAt || "")).getTime();
            return Number.isFinite(a) && Number.isFinite(z) && start.getTime() < z && end.getTime() > a;
          });
          if (conflict) throw new HttpError("That time overlaps an existing appointment. Choose another time or assign a different staff member.", 409);
          for (const key of ["name", "client", "email", "phone", "service", "location", "description", "status", "assignedTo"]) {
            if (typeof b[key] === "string") patch[key] = clean(b[key], key === "description" ? 2000 : key === "location" ? 500 : 180);
          }
          patch.startAt = start.toISOString();
          patch.endAt = end.toISOString();
        } else {
          if (typeof b.status === "string") patch.status = clean(b.status, 40);
          if (typeof b.description === "string") patch.description = clean(b.description, 2000);
        }
        await updateRecord(workspaceId, resource, id, patch);
        const item = resource === "appointments" ? (await listRecords(workspaceId, resource)).find(row => row.id === id) : undefined;
        return json({ updated: true, ...(item ? { item } : {}) });
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
