export type AgentContext = { leads?: any[]; customers?: any[]; invoices?: any[]; tasks?: any[]; appointments?: any[]; expenses?: any[] };
export class LeadLoopAgent {
  businessName: string;
  constructor(options: { businessName?: string } = {}) { this.businessName = options.businessName || "LeadLoop SA"; }
  score_lead(lead: any) {
    let score = 0;
    if (lead.email || lead.phone) score += 20;
    if (lead.company) score += 10;
    if (lead.serviceRequested || lead.service || lead.description) score += 15;
    if (Number(lead.amount || lead.budget) > 0) score += 15;
    if (["Qualified", "Interested"].includes(lead.status)) score += 25;
    else if (lead.status === "New") score += 10;
    if (lead.consentToContact === true) score += 10;
    if (Number(lead.lastContactDaysAgo) > 14) score += 5;
    score = Math.min(100, score);
    return { score, priority: score >= 70 ? "Hot" : score >= 40 ? "Warm" : "Cold" };
  }
  draft_email(lead: any) {
    const name = String(lead.name || lead.client || lead.title || "there");
    return { recordType: "leads", recordId: String(lead.id), channel: "email", to: String(lead.email || ""), subject: "Following up on your enquiry", body: `Hi ${name},\n\nI’m following up on your enquiry about ${lead.serviceRequested || lead.service || "your requirements"}. Please let me know if you still need assistance and what would be useful as a next step.\n\nKind regards,\n${this.businessName}` };
  }
  classify_reply(reply: string) {
    const s = reply.toLowerCase();
    if (/stop|unsubscribe|do not contact|not interested/.test(s)) return "Not interested / opt-out";
    if (/price|quote|cost|how much/.test(s)) return "Pricing enquiry";
    if (/call|meeting|appointment|available/.test(s)) return "Wants a meeting";
    if (/yes|interested|proceed|go ahead/.test(s)) return "Interested";
    return "Needs review";
  }
  check_calendar_availability(appointments: any[], date: string, time?: string) {
    const target = new Date(time ? date + "T" + time : date);
    if (!Number.isFinite(target.getTime())) return { available: false, conflicts: [] };
    const conflicts = appointments.filter(a => {
      if (["Cancelled", "Completed"].includes(String(a.status || ""))) return false;
      const start = new Date(String(a.startAt || a.date || ""));
      const end = new Date(String(a.endAt || (a.startAt ? new Date(start.getTime() + 3600000).toISOString() : "")));
      return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && target >= start && target < end;
    });
    return { available: conflicts.length === 0, conflicts };
  }
  calculate_profit(invoices: any[], expenses: any[]) {
    const revenue = invoices.filter(i => i.status === "Paid").reduce((n,i) => n + Number(i.amount || i.total || 0), 0);
    const costs = expenses.reduce((n,e) => n + Number(e.amount || 0), 0);
    return { revenue, expenses: costs, profit: revenue - costs };
  }
  find_duplicate_leads(leads: any[]) {
    const seen = new Map<string, any>(), duplicates: any[] = [];
    for (const lead of leads) {
      const key = String(lead.email || lead.phone || "").trim().toLowerCase();
      if (!key) continue;
      if (seen.has(key)) duplicates.push({ first: seen.get(key).id || seen.get(key).name, duplicate: lead.id || lead.name });
      else seen.set(key, lead);
    }
    return duplicates;
  }
  async chat(message: string, context: AgentContext = {}): Promise<{ reply: string; needsApproval?: boolean; data?: any }> {
    const q = message.toLowerCase(), leads = context.leads || [], tasks = context.tasks || [], appointments = context.appointments || [];
    const invoices = context.invoices || [], expenses = context.expenses || [];
    if (/score|rank|hot lead|best lead|priority lead/.test(q)) {
      const rows = leads.map(lead => ({ lead, ...this.score_lead(lead) })).sort((a,b) => b.score-a.score).slice(0,8);
      return { reply: rows.length ? rows.map((x,i) => `${i+1}. ${x.lead.name || x.lead.client || "Unnamed lead"}: ${x.priority} (${x.score}/100)`).join("\n") : "There are no leads recorded yet." };
    }
    if (/follow.?up|overdue|due today|what should i do today/.test(q)) {
      const today = new Date(); today.setHours(0,0,0,0);
      const due = tasks.filter(t => t.dueDate && !["Done","Completed","Cancelled"].includes(String(t.status || "")) && new Date(String(t.dueDate)).setHours(0,0,0,0) <= today.getTime());
      return { reply: due.length ? due.map(t => `• ${t.name || t.title || "Untitled task"} · due ${new Date(String(t.dueDate)).toLocaleDateString("en-ZA")}`).join("\n") : "No overdue or due-today tasks are recorded." };
    }
    if (/draft|write|prepare/.test(q) && /(email|message|whatsapp|follow.?up)/.test(q)) {
      const eligible = leads.filter(l => l.consentToContact === true && l.email).sort((a,b) => this.score_lead(b).score-this.score_lead(a).score);
      if (!eligible.length) return { reply: "I can only prepare an email draft for an existing lead with an email address and recorded contact consent. No eligible lead is available." };
      return { reply: `I prepared an email draft for ${eligible[0].name || eligible[0].client || "the highest-priority lead"}. It has not been sent. It will appear in Messages for owner/admin approval.`, needsApproval: true, data: this.draft_email(eligible[0]) };
    }
    if (/revenue|profit|expenses|financial|money/.test(q)) {
      const p = this.calculate_profit(invoices, expenses);
      return { reply: `Recorded paid-invoice revenue: R${p.revenue.toFixed(2)}\nRecorded expenses: R${p.expenses.toFixed(2)}\nDifference: R${p.profit.toFixed(2)}\n\nThis uses all loaded records, not a month-specific report.` };
    }
    if (/appointment|calendar|availability|available/.test(q)) {
      const upcoming = appointments.filter(a => a.startAt && new Date(String(a.startAt)).getTime() >= Date.now()).sort((a,b) => new Date(String(a.startAt)).getTime()-new Date(String(b.startAt)).getTime());
      return { reply: upcoming.length ? "Upcoming appointments:\n" + upcoming.slice(0,8).map(a => `• ${a.name || a.client || "Appointment"} · ${new Date(String(a.startAt)).toLocaleString("en-ZA")} · ${a.status || "status not set"}`).join("\n") : "No upcoming appointments are recorded. Give me a date and time to check for conflicts." };
    }
    if (/duplicate/.test(q)) {
      const d = this.find_duplicate_leads(leads);
      return { reply: d.length ? d.map(x => `Possible duplicate: ${x.first} / ${x.duplicate}`).join("\n") : "No duplicate lead email addresses or phone numbers were found in the loaded records." };
    }
    if (/find businesses|businesses|prospects|companies/.test(q)) return { reply: "Which industry and location should we target for business prospects?" };
    if (/lead source|where.*leads|marketing source/.test(q)) return { reply: "Lead sources worth testing for South African service businesses include Google Business Profiles, referrals, local Facebook groups, business directories and direct outreach. Record the source on each lead so performance can be measured." };
    return { reply: `I’m the rule-based ${this.businessName} agent. I can score leads, find overdue and due-today follow-ups, prepare consent-checked email drafts for approval, summarize recorded revenue and expenses, review appointments, identify duplicate leads and suggest lead sources.` };
  }
}
