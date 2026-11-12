import { useEffect, useMemo, useState } from 'react';
import { auth, api, invitesClient } from './lib/platform';
import {
  Activity,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardList,
  CreditCard,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Plus,
  Search,
  Send,
  Settings,
  Sparkles,
  Target,
  Users,
  Wallet,
  X,
  Zap,
  ChartNoAxesCombined,
  type LucideIcon,
} from 'lucide-react';

type User = { userId: string; email?: string; name?: string };
type Workspace = {
  id: string;
  name: string;
  industry?: string;
  currency?: string;
  role: string;
  trialEndsAt?: string;
};
type RecordItem = { id: string; [key: string]: unknown };
type Section =
  | 'Overview'
  | 'Leads'
  | 'Customers'
  | 'Projects'
  | 'Tasks'
  | 'Calendar'
  | 'Quotes'
  | 'Invoices'
  | 'Expenses'
  | 'Payments'
  | 'Marketing'
  | 'Messages'
  | 'Analytics'
  | 'Team'
  | 'Settings';

const sections: {
  name: Section;
  icon: typeof LayoutDashboard;
  group: string;
}[] = [
  { name: 'Overview', icon: LayoutDashboard, group: 'Workspace' },
  { name: 'Leads', icon: Target, group: 'Workspace' },
  { name: 'Customers', icon: Users, group: 'Workspace' },
  { name: 'Projects', icon: BriefcaseBusiness, group: 'Workspace' },
  { name: 'Tasks', icon: ClipboardList, group: 'Workspace' },
  { name: 'Calendar', icon: CalendarDays, group: 'Workspace' },
  { name: 'Quotes', icon: FileText, group: 'Money' },
  { name: 'Invoices', icon: CreditCard, group: 'Money' },
  { name: 'Expenses', icon: Wallet, group: 'Money' },
  { name: 'Payments', icon: CreditCard, group: 'Money' },
  { name: 'Marketing', icon: MessageSquareText, group: 'Growth' },
  { name: 'Messages', icon: Send, group: 'Growth' },
  { name: 'Analytics', icon: ChartNoAxesCombined, group: 'Growth' },
  { name: 'Team', icon: Users, group: 'Manage' },
  { name: 'Settings', icon: Settings, group: 'Manage' },
];

const resourceMap: Partial<Record<Section, string>> = {
  Leads: 'leads',
  Customers: 'customers',
  Projects: 'projects',
  Tasks: 'tasks',
  Calendar: 'appointments',
  Quotes: 'quotes',
  Invoices: 'invoices',
  Expenses: 'expenses',
  Payments: 'payments',
  Marketing: 'campaigns',
};

function money(value: unknown) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}
function dateLabel(value?: string) {
  if (!value) return 'Not set';
  return new Intl.DateTimeFormat('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function monthDates(value: Date) {
  const first = new Date(value.getFullYear(), value.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [, setWorkspaces] = useState<Workspace[]>([]);
  const [section, setSection] = useState<Section>('Overview');
  const [calendarCursor, setCalendarCursor] = useState(() => new Date());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(() => new Date());
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [overview, setOverview] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [search, setSearch] = useState('');
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [workspaceName, setWorkspaceName] = useState('');
  const [industry, setIndustry] = useState('Professional services');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('employee');
  const [inviteUrl, setInviteUrl] = useState('');
  const [publicRouteToken] = useState<string | null>(() => {
    const match = window.location.hash.match(/^#\/enquiry\/([A-Za-z0-9-]+)$/);
    return match?.[1] || null;
  });
  const [, setPublicEnquiryToken] = useState<string | null>(null);
  const [publicBusinessName, setPublicBusinessName] = useState('');
  const [publicForm, setPublicForm] = useState({ name: '', email: '', phone: '', company: '', serviceRequested: '', message: '', consent: false, website: '' });
  const [publicLoading, setPublicLoading] = useState(false);
  const [publicSubmitted, setPublicSubmitted] = useState(false);
  const [publicError, setPublicError] = useState('');
  const [publicEnquiryUrl, setPublicEnquiryUrl] = useState('');
  const [publicEnquiryBusy, setPublicEnquiryBusy] = useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState<{ connected: boolean; status: string; canStartEmbeddedSignup: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!publicRouteToken) return;
    let alive = true;
    api.get('/api/public/enquiries/' + publicRouteToken)
      .then(result => {
        if (alive) setPublicBusinessName(result.data.businessName || 'Business');
      })
      .catch(error => {
        if (alive) setPublicError(error instanceof Error ? error.message : 'This enquiry link is unavailable.');
      });
    return () => { alive = false; };
  }, [publicRouteToken]);

  useEffect(() => {
    let alive = true;
    auth
      .getUser()
      .then(async restored => {
        if (!alive) return;
        setUser(restored);
        setAuthReady(true);
        if (restored) {
          try {
            const response = await api.get('/api/workspaces');
            if (!alive) return;
            const list = response.data.workspaces || [];
            setWorkspaces(list);
            const pending = invitesClient.getPendingCode();
            if (pending) {
              setNotice(
                'You have a pending team invitation. Accept it to join the business workspace.'
              );
              setForm(old => ({ ...old, inviteCode: pending }));
            } else if (list.length) {
              setWorkspace(list[0]);
            }
          } catch (error) {
            setNotice(
              error instanceof Error
                ? error.message
                : 'Could not load your workspaces.'
            );
          }
        }
      })
      .catch(() => {
        if (alive) {
          setAuthReady(true);
          setNotice('Sign-in could not be restored. Please try again.');
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!workspace) return;
    refreshSection();
  }, [workspace?.id, section]);

  async function refreshSection() {
    if (!workspace) return;
    setLoading(true);
    try {
      if (section === 'Overview' || section === 'Analytics') {
        const result = await api.get(
          '/api/workspaces/' + workspace.id + '/overview'
        );
        setOverview(result.data.metrics || {});
      }
      const resource = resourceMap[section];
      if (resource) {
        const result = await api.get(
          '/api/workspaces/' + workspace.id + '/' + resource
        );
        setRecords(result.data.items || []);
      } else if (section === 'Team') {
        const result = await api.get(
          '/api/workspaces/' + workspace.id + '/members'
        );
        setRecords(result.data.items || []);
      } else if (section === 'Messages') {
        const result = await api.get('/api/workspaces/' + workspace.id + '/messages');
        setRecords(result.data.items || []);
      }
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Could not load this section.'
      );
    } finally {
      setLoading(false);
    }
  }

  async function managePublicEnquiry(enabled: boolean) {
    if (!workspace) return;
    setPublicEnquiryBusy(true);
    try {
      const result = await api.post('/api/workspaces/' + workspace.id + '/public-enquiry', { enabled });
      const token = result.data.token as string | null;
      setPublicEnquiryToken(token);
      setPublicEnquiryUrl(token ? window.location.origin + window.location.pathname + '#/enquiry/' + token : '');
      setNotice(enabled ? 'Your public enquiry form is enabled.' : 'Your public enquiry form has been disabled.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not update the public enquiry form.');
    } finally {
      setPublicEnquiryBusy(false);
    }
  }

  async function submitPublicEnquiry() {
    if (!publicRouteToken || publicLoading) return;
    setPublicLoading(true);
    setPublicError('');
    try {
      await api.post('/api/public/enquiries/' + publicRouteToken, publicForm);
      setPublicSubmitted(true);
    } catch (error) {
      setPublicError(error instanceof Error ? error.message : 'Your enquiry could not be submitted. Please retry.');
    } finally {
      setPublicLoading(false);
    }
  }

  async function signIn() {
    try {
      await auth.signInWithRedirect();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Sign-in failed. Please retry.'
      );
    }
  }

  async function createWorkspace() {
    if (!workspaceName.trim()) {
      setNotice('Enter a business name first.');
      return;
    }
    setLoading(true);
    try {
      const result = await api.post('/api/workspaces', {
        name: workspaceName.trim(),
        industry,
      });
      const created = result.data.workspace as Workspace;
      setWorkspace(created);
      setWorkspaces(old => [created, ...old]);
      setWorkspaceName('');
      setNotice(
        'Your business workspace is ready. Your full-feature trial has started.'
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Workspace creation failed.'
      );
    } finally {
      setLoading(false);
    }
  }

  async function saveRecord() {
    const resource = resourceMap[section];
    if (!workspace || !resource) return;
    const title =
      form.name?.trim() || form.title?.trim() || form.client?.trim();
    if (!title) {
      setNotice('Add a name or title before saving.');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        ...form,
        amount: form.amount ? Number(form.amount) : undefined,
      };
      const result = await api.post(
        '/api/workspaces/' + workspace.id + '/' + resource,
        payload
      );
      setRecords(old => [result.data.item, ...old]);
      setForm({});
      setShowCreate(false);
      setNotice(
        section === 'Leads'
          ? result.data.automation?.message || 'Lead saved.'
          : section.slice(0, -1) + ' saved.'
      );
      if (section === 'Leads') {
        const resultOverview = await api.get(
          '/api/workspaces/' + workspace.id + '/overview'
        );
        setOverview(resultOverview.data.metrics || {});
      }
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Could not save this record.'
      );
    } finally {
      setLoading(false);
    }
  }

  async function approveMessage(item: RecordItem) {
    if (!workspace || item.status !== 'Pending approval') return;
    try {
      const result = await api.post('/api/workspaces/' + workspace.id + '/messages/' + item.id + '/approve', {});
      setRecords(old => old.map(row => row.id === item.id ? { ...row, status: result.data.status, approvalStatus: 'Approved', deliveryStatus: 'Not sent - open the email app to send manually' } : row));
      setNotice(item.channel === 'email'
        ? 'Email approved. Open Gmail compose below, review the recipient and message, then press Send yourself. LeadLoop will not send it automatically.'
        : 'Message approved. It has NOT been sent. WhatsApp delivery is not connected.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not approve this message.');
    }
  }

  async function markEmailSentManually(item: RecordItem) {
    if (!workspace || item.channel !== 'email' || item.status !== 'Approved - awaiting connection') return;
    try {
      const result = await api.post('/api/workspaces/' + workspace.id + '/messages/' + item.id + '/mark-sent', {});
      setRecords(old => old.map(row => row.id === item.id ? { ...row, status: result.data.status, deliveryStatus: result.data.deliveryStatus } : row));
      setNotice('Marked as sent based on your confirmation. Gmail delivery has not been independently verified.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not update this message.');
    }
  }

  async function updateStatus(item: RecordItem, status: string) {
    const resource = resourceMap[section];
    if (!workspace || !resource) return;
    try {
      await api.put(
        '/api/workspaces/' + workspace.id + '/' + resource + '/' + item.id,
        { status }
      );
      setRecords(old =>
        old.map(row => (row.id === item.id ? { ...row, status } : row))
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Update failed.');
    }
  }

  async function inviteMember() {
    if (!workspace || !inviteEmail.includes('@')) {
      setNotice('Enter a valid employee email address.');
      return;
    }
    setLoading(true);
    try {
      const result = await api.post(
        '/api/workspaces/' + workspace.id + '/invites',
        { email: inviteEmail.trim(), role: inviteRole }
      );
      const url = invitesClient.buildJoinUrl(result.data.code, {
        path: '#/join',
      });
      setInviteUrl(url);
      setNotice(
        'Invitation created. Copy the link and send it to your employee.'
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Could not create invitation.'
      );
    } finally {
      setLoading(false);
    }
  }

  async function acceptInvite() {
    const code = form.inviteCode || invitesClient.getPendingCode();
    if (!code) return;
    setLoading(true);
    try {
      await api.post('/api/invites/' + code + '/join', {});
      invitesClient.clearPendingCode();
      const result = await api.get('/api/workspaces');
      setWorkspaces(result.data.workspaces || []);
      setWorkspace((result.data.workspaces || [])[0] || null);
      setNotice('You have joined the business workspace.');
      setForm({});
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'Invitation could not be accepted.'
      );
    } finally {
      setLoading(false);
    }
  }

  async function askAI() {
    if (!workspace || !aiQuestion.trim()) return;
    setAiBusy(true);
    setAiAnswer('');
    try {
      const result = await api.get(
        '/api/workspaces/' + workspace.id + '/assistant?question=' + encodeURIComponent(aiQuestion.trim()) + '&section=' + encodeURIComponent(section)
      );
      setAiAnswer(result.data.answer || 'No answer was returned.');
    } catch (error) {
      setAiAnswer(
        (error instanceof Error
          ? error.message
          : 'The assistant is unavailable.') + ' You can retry in a moment.'
      );
    } finally {
      setAiBusy(false);
    }
  }

  async function signOut() {
    await auth.signOut();
    setUser(null);
    setWorkspace(null);
    setWorkspaces([]);
  }

  const calendarDays = monthDates(calendarCursor);
  const selectedDayAppointments = records
    .filter(item => item.startAt && new Date(String(item.startAt)).toDateString() === selectedCalendarDate.toDateString())
    .sort((a, b) => new Date(String(a.startAt)).getTime() - new Date(String(b.startAt)).getTime());

  const visibleRecords = useMemo(
    () =>
      records.filter(item =>
        JSON.stringify(item).toLowerCase().includes(search.toLowerCase())
      ),
    [records, search]
  );
  const trialDays = workspace?.trialEndsAt
    ? Math.max(
        0,
        Math.ceil(
          (new Date(workspace.trialEndsAt).getTime() - Date.now()) / 86400000
        )
      )
    : 14;

  useEffect(() => {
    if (!workspace || !(workspace.role === 'owner' || workspace.role === 'admin')) return;
    let alive = true;
    api.get('/api/workspaces/' + workspace.id + '/public-enquiry')
      .then(result => {
        if (!alive) return;
        const token = result.data.enabled ? result.data.token as string : null;
        setPublicEnquiryToken(token);
        setPublicEnquiryUrl(token ? window.location.origin + window.location.pathname + '#/enquiry/' + token : '');
      })
      .catch(() => {
        if (alive) {
          setPublicEnquiryToken(null);
          setPublicEnquiryUrl('');
        }
      });
    return () => { alive = false; };
  }, [workspace?.id, workspace?.role]);

  useEffect(() => {
    if (!workspace) {
      setWhatsappStatus(null);
      return;
    }
    let alive = true;
    api.get('/api/workspaces/' + workspace.id + '/integrations/whatsapp')
      .then(result => {
        if (alive) setWhatsappStatus(result.data);
      })
      .catch(() => {
        if (alive) setWhatsappStatus({
          connected: false,
          status: 'unavailable',
          canStartEmbeddedSignup: false,
          message: 'WhatsApp integration status could not be loaded. Refresh and try again.',
        });
      });
    return () => { alive = false; };
  }, [workspace?.id]);

  if (publicRouteToken) {
    return (
      <main className="public-enquiry-page">
        <div className="public-enquiry-card">
          <div className="brand">
            <div className="brand-mark">L</div>
            <span>leadloop<span className="brand-dot">.</span></span>
          </div>
          {publicSubmitted ? (
            <div className="public-success">
              <div className="public-success-icon"><Check size={28} /></div>
              <span className="eyebrow">ENQUIRY RECEIVED</span>
              <h1>Thank you, {publicForm.name.trim()}.</h1>
              <p>Your enquiry has been submitted to {publicBusinessName || 'the business'}. The business will review the details you provided.</p>
            </div>
          ) : (
            <>
              <span className="eyebrow">GET IN TOUCH</span>
              <h1>Contact {publicBusinessName || 'the business'}</h1>
              <p className="public-intro">Send your enquiry directly to the business. Only provide details you are comfortable sharing.</p>
              {publicError && <div className="notice">{publicError}</div>}
              <form onSubmit={event => { event.preventDefault(); submitPublicEnquiry(); }}>
                <label>Your name *
                  <input required maxLength={180} value={publicForm.name} onChange={event => setPublicForm({ ...publicForm, name: event.target.value })} />
                </label>
                <div className="form-row">
                  <label>Email address
                    <input type="email" maxLength={180} value={publicForm.email} onChange={event => setPublicForm({ ...publicForm, email: event.target.value })} placeholder="name@example.com" />
                  </label>
                  <label>Phone number
                    <input maxLength={50} value={publicForm.phone} onChange={event => setPublicForm({ ...publicForm, phone: event.target.value })} placeholder="+27..." />
                  </label>
                </div>
                <small className="public-hint">Provide at least an email address or phone number.</small>
                <label>Company (optional)
                  <input maxLength={180} value={publicForm.company} onChange={event => setPublicForm({ ...publicForm, company: event.target.value })} />
                </label>
                <label>What do you need help with?
                  <input maxLength={180} value={publicForm.serviceRequested} onChange={event => setPublicForm({ ...publicForm, serviceRequested: event.target.value })} placeholder="Service or product" />
                </label>
                <label>Your message
                  <textarea rows={4} maxLength={2000} value={publicForm.message} onChange={event => setPublicForm({ ...publicForm, message: event.target.value })} placeholder="Tell the business what you need..." />
                </label>
                <div className="public-honeypot" aria-hidden="true">
                  <label>Leave this field empty<input tabIndex={-1} autoComplete="off" value={publicForm.website} onChange={event => setPublicForm({ ...publicForm, website: event.target.value })} /></label>
                </div>
                <label className="public-consent">
                  <input type="checkbox" checked={publicForm.consent} onChange={event => setPublicForm({ ...publicForm, consent: event.target.checked })} />
                  <span>I agree that this business may contact me about this enquiry. *</span>
                </label>
                <button className="primary full" type="submit" disabled={publicLoading || !publicForm.consent || (!publicForm.email.trim() && !publicForm.phone.trim())}>
                  {publicLoading ? 'Sending enquiry…' : 'Submit enquiry'} <ArrowUpRight size={16} />
                </button>
              </form>
              <small className="public-foot">Your details will be shared with {publicBusinessName || 'this business'} for the purpose of responding to your enquiry.</small>
            </>
          )}
        </div>
      </main>
    );
  }

  if (!authReady)
    return (
      <div className="boot">
        <div className="brand-mark">L</div>
        <span>Preparing your workspace…</span>
      </div>
    );

  if (!user)
    return (
      <main className="landing-page">
        <header className="landing-nav">
          <a className="brand landing-brand" href="#" aria-label="LeadLoop home">
            <span className="brand-mark">L</span>
            <span>leadloop<span className="brand-dot">.</span></span>
          </a>
          <nav className="landing-links" aria-label="Main navigation">
            <a href="#platform">Platform</a>
            <a href="#how-it-works">How it works</a>
            <a href="#built-for-sa">Built for SA</a>
          </nav>
          <div className="landing-nav-actions">
            <button className="landing-signin" onClick={signIn}>Sign in</button>
            <button className="primary landing-nav-cta" onClick={signIn}>
              Start free trial <ArrowUpRight size={16} />
            </button>
          </div>
        </header>

        <section className="landing-hero">
          <div className="landing-hero-copy">
            <div className="landing-kicker"><span className="pulse" /> THE BUSINESS OPERATING PLATFORM</div>
            <h1>More enquiries.<br /><em>More jobs.</em><br />Less missed opportunities.</h1>
            <p className="landing-lede">
              Your leads, customers, projects, tasks and money belong in one connected workspace.
              LeadLoop helps you keep the whole business moving, with one AI assistant alongside you.
            </p>
            <div className="landing-hero-actions">
              <button className="primary large" onClick={signIn}>
                Start your 14-day free trial <ArrowUpRight size={17} />
              </button>
              <a className="landing-secondary-link" href="#platform">Explore the platform <span>↓</span></a>
            </div>
            <div className="landing-proof-points">
              <span><Check size={15} /> No payment details to start</span>
              <span><Check size={15} /> Designed for South African businesses</span>
            </div>
          </div>

          <div className="landing-preview-wrap" aria-label="Illustrative LeadLoop workspace preview">
            <div className="preview-glow" />
            <div className="preview-window">
              <div className="preview-topbar">
                <div className="preview-brand"><span className="brand-mark">L</span><b>leadloop<span className="brand-dot">.</span></b></div>
                <span className="preview-live"><i /> WORKSPACE PREVIEW</span>
              </div>
              <div className="preview-body">
                <aside className="preview-sidebar">
                  <span className="preview-side-active"><LayoutDashboard size={13} /> Overview</span>
                  <span><Target size={13} /> Leads</span>
                  <span><Users size={13} /> Customers</span>
                  <span><BriefcaseBusiness size={13} /> Projects</span>
                  <span><FileText size={13} /> Quotes & invoices</span>
                  <span><Sparkles size={13} /> LeadLoop AI</span>
                </aside>
                <div className="preview-main">
                  <div className="preview-heading">
                    <div><small>YOUR BUSINESS AT A GLANCE</small><b>Good morning. Here's your workspace.</b></div>
                    <span className="preview-avatar">LL</span>
                  </div>
                  <div className="preview-metrics">
                    <div><small>LEADS</small><b>One clear view</b><span>Every enquiry in one place</span></div>
                    <div><small>FOLLOW-UPS</small><b>Nothing forgotten</b><span>Tasks linked to your leads</span></div>
                    <div><small>MONEY</small><b>Know what is due</b><span>Quotes, invoices and expenses</span></div>
                  </div>
                  <div className="preview-lower">
                    <div className="preview-panel">
                      <div className="preview-panel-title"><b>Business activity</b><span>WORKSPACE DATA</span></div>
                      <div className="preview-activity"><i className="activity-dot green" /><span><b>New enquiry received</b><small>Review the lead and plan the next step</small></span></div>
                      <div className="preview-activity"><i className="activity-dot blue" /><span><b>Customer project updated</b><small>Keep delivery and tasks together</small></span></div>
                      <div className="preview-activity"><i className="activity-dot lime" /><span><b>Invoice ready to review</b><small>Track status without losing the details</small></span></div>
                    </div>
                    <div className="preview-ai">
                      <div className="preview-ai-icon"><Sparkles size={17} /></div>
                      <small>ONE UNIFIED AI</small>
                      <b>Your business context, connected.</b>
                      <span>Ask questions, draft replies and work with your records.</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="preview-caption">Illustrative product preview · Sample interface, not live business data</div>
            </div>
          </div>
        </section>

        <div className="landing-trust-strip">
          <span>BUILT TO CONNECT THE WORK THAT RUNS A BUSINESS</span>
          <div><b>ENQUIRIES</b><i /> <b>CUSTOMERS</b><i /> <b>OPERATIONS</b><i /> <b>FINANCES</b><i /> <b>TEAM</b></div>
        </div>

        <section className="landing-section" id="platform">
          <div className="landing-section-heading">
            <span className="landing-eyebrow">ONE WORKSPACE. LESS SCATTER.</span>
            <h2>Stop running your business<br /><em>across ten different places.</em></h2>
            <p>LeadLoop brings the everyday moving parts together, so you can spend less time chasing information and more time doing the work.</p>
          </div>
          <div className="landing-feature-grid">
            <article className="landing-feature-card feature-leads">
              <div className="landing-feature-icon"><Target size={21} /></div>
              <span className="landing-card-label">01 / GROWTH</span>
              <h3>Keep every enquiry moving.</h3>
              <p>Capture leads, keep their details together and create review tasks so new opportunities do not get buried in messages.</p>
              <span className="landing-card-foot">Leads · Enquiry forms · Follow-up tasks</span>
            </article>
            <article className="landing-feature-card">
              <div className="landing-feature-icon"><Users size={21} /></div>
              <span className="landing-card-label">02 / CUSTOMERS</span>
              <h3>Know who you're working with.</h3>
              <p>Keep customer information, project context and activity connected to the right business records.</p>
              <span className="landing-card-foot">Customers · Projects · Tasks</span>
            </article>
            <article className="landing-feature-card">
              <div className="landing-feature-icon"><Wallet size={21} /></div>
              <span className="landing-card-label">03 / FINANCES</span>
              <h3>Keep an eye on the money.</h3>
              <p>Organize quotes, invoices, expenses and payment records. See what is recorded and what still needs attention.</p>
              <span className="landing-card-foot">Quotes · Invoices · Expenses · Payments</span>
            </article>
            <article className="landing-feature-card">
              <div className="landing-feature-icon"><Sparkles size={21} /></div>
              <span className="landing-card-label">04 / INTELLIGENCE</span>
              <h3>One AI across your business.</h3>
              <p>Ask about your workspace, draft customer replies and work with supported records using one shared business context.</p>
              <span className="landing-card-foot">One assistant · Shared workspace context</span>
            </article>
            <article className="landing-feature-card">
              <div className="landing-feature-icon"><MessageSquareText size={21} /></div>
              <span className="landing-card-label">05 / COMMUNICATION</span>
              <h3>Prepare better customer replies.</h3>
              <p>Draft and approve messages inside LeadLoop. Email drafts can open in your email app for you to review and send yourself.</p>
              <span className="landing-card-foot">Message drafts · Approval · Manual send</span>
            </article>
            <article className="landing-feature-card">
              <div className="landing-feature-icon"><Building2 size={21} /></div>
              <span className="landing-card-label">06 / TEAM</span>
              <h3>Bring your people into the picture.</h3>
              <p>Invite team members into a workspace and assign access according to their role.</p>
              <span className="landing-card-foot">Team invitations · Workspace roles</span>
            </article>
          </div>
        </section>

        <section className="landing-workflow-section" id="how-it-works">
          <div className="landing-workflow-inner">
            <div>
              <span className="landing-eyebrow">A CLEARER WAY TO WORK</span>
              <h2>From first enquiry<br />to work <em>well managed.</em></h2>
              <p>Start with the information you already have. Build a clearer picture of your business as you go.</p>
              <button className="primary" onClick={signIn}>Set up your workspace <ArrowUpRight size={16} /></button>
            </div>
            <div className="landing-steps">
              <div><span>01</span><section><b>Bring enquiries in</b><p>Share your public enquiry form or add a lead yourself.</p></section></div>
              <div><span>02</span><section><b>Keep the details connected</b><p>Organize customers, projects, tasks and conversations in one workspace.</p></section></div>
              <div><span>03</span><section><b>Make the next move</b><p>Use your records and the unified AI assistant to plan, draft and manage supported actions.</p></section></div>
            </div>
          </div>
        </section>

        <section className="landing-sa-section" id="built-for-sa">
          <div className="landing-sa-mark"><Building2 size={25} /></div>
          <div>
            <span className="landing-eyebrow">MADE WITH LOCAL BUSINESSES IN MIND</span>
            <h2>Built for the way<br /><em>South African businesses work.</em></h2>
            <p>LeadLoop is configured for South African business operations, with ZAR currency formatting and a practical workspace for service businesses, freelancers, growing teams and more.</p>
          </div>
          <div className="landing-sa-points">
            <span><Check size={16} /> ZAR currency support</span>
            <span><Check size={16} /> Service-business workflows</span>
            <span><Check size={16} /> Mobile-friendly access</span>
          </div>
        </section>

        <section className="landing-roadmap">
          <div className="landing-roadmap-copy">
            <span className="landing-eyebrow">IN DEVELOPMENT</span>
            <h2>Missed-call recovery,<br /><em>inside LeadLoop.</em></h2>
            <p>We're working toward a phone-to-enquiry workflow that helps businesses recover opportunities when they cannot answer a call. It will use the same LeadLoop AI and workspace, with a supported phone and messaging connection required. It is not active yet.</p>
          </div>
          <div className="landing-roadmap-visual">
            <div className="roadmap-call"><Activity size={18} /><span><b>Missed call detected</b><small>Phone connection required</small></span></div>
            <div className="roadmap-line" />
            <div className="roadmap-call"><MessageSquareText size={18} /><span><b>Customer enquiry captured</b><small>Planned workflow</small></span></div>
            <div className="roadmap-line" />
            <div className="roadmap-call"><Target size={18} /><span><b>Lead added to workspace</b><small>One LeadLoop workspace</small></span></div>
          </div>
        </section>

        <section className="landing-final-cta">
          <span className="landing-eyebrow">YOUR BUSINESS, MORE CONNECTED</span>
          <h2>Make room for the work<br /><em>that actually moves you forward.</em></h2>
          <p>Start with a 14-day full-feature trial. No payment details are required to get started.</p>
          <button className="primary large" onClick={signIn}>Create your free trial <ArrowUpRight size={17} /></button>
          <small>Subscription and billing options will be introduced before paid plans launch.</small>
        </section>

        <footer className="landing-footer">
          <a className="brand" href="#" aria-label="LeadLoop home"><span className="brand-mark">L</span><span>leadloop<span className="brand-dot">.</span></span></a>
          <span>LEADLOOP SA · More enquiries. More jobs. Less missed opportunities.</span>
          <button onClick={signIn}>Sign in <ArrowUpRight size={14} /></button>
        </footer>
      </main>
    );

  if (!workspace)
    return (
      <main className="onboarding">
        <div className="brand">
          <div className="brand-mark">L</div>
          <span>
            leadloop<span className="brand-dot">.</span>
          </span>
        </div>
        <div className="onboard-card">
          <div className="eyebrow">YOUR BUSINESS STARTS HERE</div>
          <h1>Create your workspace</h1>
          <p>
            Set up your business hub. You can invite your team once you're
            inside.
          </p>
          {form.inviteCode && (
            <div className="invite-pending">
              <b>You've been invited to a team.</b>
              <span>Accept the invitation to join the existing workspace.</span>
              <button
                className="primary"
                onClick={acceptInvite}
                disabled={loading}
              >
                Accept invitation
              </button>
            </div>
          )}
          <label>
            Business name
            <input
              value={workspaceName}
              onChange={e => setWorkspaceName(e.target.value)}
              placeholder="e.g. Northstar Services"
            />
          </label>
          <label>
            Industry
            <select
              value={industry}
              onChange={e => setIndustry(e.target.value)}
            >
              <option>Professional services</option>
              <option>Construction & trades</option>
              <option>Retail & e-commerce</option>
              <option>Marketing & creative</option>
              <option>Technology</option>
              <option>Other</option>
            </select>
          </label>
          <button
            className="primary full"
            onClick={createWorkspace}
            disabled={loading}
          >
            {loading ? 'Creating…' : 'Create business workspace'}{' '}
            <ArrowUpRight size={17} />
          </button>
          <small>
            14-day full-feature trial. No payment details required to start.
          </small>
        </div>
      </main>
    );

  const isOwner = workspace.role === 'owner' || workspace.role === 'admin';
  const currentResource = resourceMap[section];
  const titleField =
    section === 'Invoices' || section === 'Quotes' || section === 'Payments' ? 'client' : 'name';

  return (
    <div className="app-shell">
      <aside className={'sidebar ' + (mobileNav ? 'open' : '')}>
        <div className="sidebar-brand">
          <div className="brand-mark">L</div>
          <span>
            leadloop<span className="brand-dot">.</span>
          </span>
          <button
            className="icon-btn close-nav"
            onClick={() => setMobileNav(false)}
          >
            <X />
          </button>
        </div>
        <div className="workspace-switch">
          <div className="workspace-avatar">
            {workspace.name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <b>{workspace.name}</b>
            <small>{workspace.industry || 'Business workspace'}</small>
          </div>
          <ChevronDown size={15} />
        </div>
        {['Workspace', 'Money', 'Growth', 'Manage'].map(group => (
          <div className="nav-group" key={group}>
            <span className="nav-label">{group}</span>
            {sections
              .filter(item => item.group === group)
              .map(item => (
                <button
                  key={item.name}
                  className={
                    'nav-link ' + (section === item.name ? 'active' : '')
                  }
                  onClick={() => {
                    setSection(item.name);
                    setMobileNav(false);
                    setSearch('');
                  }}
                >
                  <item.icon size={17} />
                  <span>{item.name}</span>
                  {item.name === 'Leads' && overview.leads ? (
                    <i>{overview.leads}</i>
                  ) : null}
                </button>
              ))}
          </div>
        ))}
        <div className="sidebar-bottom">
          <div className="trial-card">
            <div>
              <Zap size={15} /> <b>Trial active</b>
            </div>
            <strong>{trialDays} days left</strong>
            <span>All features unlocked</span>
          </div>
          <button className="profile-row" onClick={signOut}>
            <div className="profile-avatar">
              {(user.name || user.email || 'U').slice(0, 1).toUpperCase()}
            </div>
            <div>
              <b>{user.name || 'Your account'}</b>
              <small>{user.email}</small>
            </div>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="scrim"
          onClick={() => setMobileNav(false)}
          aria-label="Close navigation"
        />
      )}
      <main className="main-area">
        <header className="topbar">
          <button
            className="icon-btn mobile-menu"
            onClick={() => setMobileNav(true)}
          >
            <Menu />
          </button>
          <div className="crumb">
            Workspace <span>/</span> <b>{section}</b>
          </div>
          <div className="top-actions">
            <div className="search-box">
              <Search size={16} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search this workspace"
              />
            </div>
            <button
              className="icon-btn"
              onClick={() => setShowAI(true)}
              title="Ask LeadLoop AI"
            >
              <Sparkles />
            </button>
            <button className="icon-btn">
              <Bell />
            </button>
            <div className="top-avatar">
              {(user.name || user.email || 'U').slice(0, 1).toUpperCase()}
            </div>
          </div>
        </header>
        <div className="page">
          {notice && (
            <div className="notice">
              <span>{notice}</span>
              <button onClick={() => setNotice('')}>
                <X size={15} />
              </button>
            </div>
          )}
          {section === 'Overview' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR BUSINESS AT A GLANCE</div>
                  <h1>Good to have you back.</h1>
                  <p>Here's what's moving across {workspace.name}.</p>
                </div>
                <button className="primary" onClick={() => setShowAI(true)}>
                  <Sparkles size={16} /> Ask LeadLoop AI
                </button>
              </div>
              <div className="metric-grid">
                {([
                  ['Total leads', overview.leads || 0, Target],
                  ['Customers', overview.customers || 0, Users],
                  ['Open projects', overview.projects || 0, BriefcaseBusiness],
                  ['Tasks due', overview.tasks || 0, CalendarDays],
                  ['Revenue recorded', money(overview.revenue || 0), Wallet],
                  ['Outstanding', money(overview.outstanding || 0), CreditCard],
                ] as [string, string | number, LucideIcon][]).map(([label, value, Icon]) => (
                  <div className="metric-card" key={String(label)}>
                    <div className="metric-top">
                      <span>{label as string}</span>
                      <Icon size={17} />
                    </div>
                    <strong>{value as string | number}</strong>
                    <small>Live workspace data</small>
                  </div>
                ))}
              </div>
              <div className="dashboard-lower">
                <div className="panel">
                  <div className="panel-head">
                    <div>
                      <h3>Business pulse</h3>
                      <p>Your current operating snapshot</p>
                    </div>
                    <Activity size={18} />
                  </div>
                  <div className="pulse-list">
                    <div>
                      <span>Lead pipeline</span>
                      <b>{overview.leads || 0} active leads</b>
                    </div>
                    <div>
                      <span>Project delivery</span>
                      <b>{overview.projects || 0} active projects</b>
                    </div>
                    <div>
                      <span>Work to complete</span>
                      <b>{overview.tasks || 0} open tasks</b>
                    </div>
                    <div>
                      <span>Money to collect</span>
                      <b>{money(overview.outstanding || 0)}</b>
                    </div>
                  </div>
                </div>
                <div className="ai-card">
                  <div className="ai-orb">
                    <Sparkles />
                  </div>
                  <span className="eyebrow">YOUR AI BUSINESS PARTNER</span>
                  <h3>Make your next move count.</h3>
                  <p>
                    Ask about your pipeline, customer activity, cash flow or
                    what deserves your attention next.
                  </p>
                  <button className="secondary" onClick={() => setShowAI(true)}>
                    Open AI assistant <ArrowUpRight size={15} />
                  </button>
                </div>
              </div>
            </>
          )}
          {section === 'Analytics' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">MEASURE WHAT MATTERS</div>
                  <h1>Business analytics</h1>
                  <p>
                    Performance across your workspace, based on recorded data.
                  </p>
                </div>
              </div>
              <div className="metric-grid">
                {[
                  ['Leads', overview.leads || 0],
                  ['Customers', overview.customers || 0],
                  ['Projects', overview.projects || 0],
                  ['Tasks', overview.tasks || 0],
                  ['Revenue', money(overview.revenue || 0)],
                  ['Outstanding', money(overview.outstanding || 0)],
                ].map(([label, value]) => (
                  <div className="metric-card" key={String(label)}>
                    <div className="metric-top">
                      <span>{label}</span>
                      <ChartNoAxesCombined size={17} />
                    </div>
                    <strong>{value}</strong>
                    <small>Current workspace totals</small>
                  </div>
                ))}
              </div>
              <div className="panel analytics-note">
                <h3>Build your operating history</h3>
                <p>
                  As your team records leads, completed jobs, invoices and
                  expenses, this dashboard becomes a more useful view of
                  performance. No invented projections or vanity metrics.
                </p>
              </div>
            </>
          )}
          {section === 'Calendar' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">APPOINTMENTS & SCHEDULING</div>
                  <h1>Calendar</h1>
                  <p>Your business calendar, stored in LeadLoop. Google Calendar is not required.</p>
                </div>
                <button className="primary" onClick={() => { setForm({}); setShowCreate(true); }}>
                  <Plus size={17} /> New appointment
                </button>
              </div>
              <div className="calendar-layout">
                <div className="panel calendar-panel">
                  <div className="calendar-toolbar">
                    <button className="icon-btn" aria-label="Previous month" onClick={() => setCalendarCursor(new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1))}><ChevronDown size={16} /></button>
                    <h3>{new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric' }).format(calendarCursor)}</h3>
                    <button className="icon-btn" aria-label="Next month" onClick={() => setCalendarCursor(new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1))}><ChevronDown size={16} style={{ transform: 'rotate(180deg)' }} /></button>
                    <button className="secondary" onClick={() => { const today = new Date(); setCalendarCursor(today); setSelectedCalendarDate(today); }}>Today</button>
                  </div>
                  <div className="calendar-grid">
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <div className="calendar-weekday" key={day}>{day}</div>)}
                    {calendarDays.map(day => {
                      const dayAppointments = records.filter(item => item.startAt && new Date(String(item.startAt)).toDateString() === day.toDateString());
                      const inMonth = day.getMonth() === calendarCursor.getMonth();
                      const selected = day.toDateString() === selectedCalendarDate.toDateString();
                      return (
                        <button key={day.toISOString()} className={'calendar-day ' + (!inMonth ? 'outside ' : '') + (selected ? 'selected' : '')} onClick={() => setSelectedCalendarDate(day)}>
                          <span className="calendar-day-number">{day.getDate()}</span>
                          {dayAppointments.slice(0, 2).map(item => <span className="calendar-event-dot" key={item.id}>{String(item.name || item.title || 'Appointment')}</span>)}
                          {dayAppointments.length > 2 && <small>+{dayAppointments.length - 2} more</small>}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="panel calendar-agenda">
                  <div className="panel-head">
                    <div>
                      <h3>{new Intl.DateTimeFormat('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' }).format(selectedCalendarDate)}</h3>
                      <p>{selectedDayAppointments.length} appointment{selectedDayAppointments.length === 1 ? '' : 's'}</p>
                    </div>
                    <CalendarDays size={18} />
                  </div>
                  {selectedDayAppointments.length ? selectedDayAppointments.map(item => (
                    <div className="appointment-card" key={item.id}>
                      <div className="appointment-time">{new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit' }).format(new Date(String(item.startAt)))} – {new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit' }).format(new Date(String(item.endAt)))}</div>
                      <b>{String(item.name || item.title || 'Appointment')}</b>
                      <span>{String(item.client || 'Customer not specified')} · {String(item.service || 'Service not specified')}</span>
                      <span>{String(item.assignedTo || 'Unassigned')}{item.location ? ' · ' + String(item.location) : ''}</span>
                      <select className="status-select" value={String(item.status || 'Confirmed')} onChange={e => updateStatus(item, e.target.value)}>
                        <option>Requested</option><option>Confirmed</option><option>In progress</option><option>Completed</option><option>Cancelled</option>
                      </select>
                    </div>
                  )) : <div className="empty"><div className="empty-icon"><CalendarDays /></div><b>No appointments on this day</b><span>Select another date or create a new appointment.</span><button className="secondary" onClick={() => { setForm({ startAt: new Date(selectedCalendarDate.getFullYear(), selectedCalendarDate.getMonth(), selectedCalendarDate.getDate(), 9, 0).toISOString().slice(0, 16), endAt: new Date(selectedCalendarDate.getFullYear(), selectedCalendarDate.getMonth(), selectedCalendarDate.getDate(), 10, 0).toISOString().slice(0, 16) }); setShowCreate(true); }}>Add appointment for this day</button></div>}
                </div>
              </div>
            </>
          )}
          {currentResource && section !== 'Calendar' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {section.toUpperCase()} MANAGEMENT
                  </div>
                  <h1>{section}</h1>
                  <p>
                    Keep your {section.toLowerCase()} organized and moving
                    forward.
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => {
                    setForm({});
                    setShowCreate(true);
                  }}
                >
                  <Plus size={17} /> Add {section.slice(0, -1)}
                </button>
              </div>
              <div className="panel table-panel">
                <div className="panel-head">
                  <div>
                    <h3>All {section.toLowerCase()}</h3>
                    <p>{visibleRecords.length} records in this workspace</p>
                  </div>
                  <button className="icon-btn" onClick={refreshSection}>
                    <Activity size={16} />
                  </button>
                </div>
                {loading ? (
                  <div className="empty">Loading records…</div>
                ) : visibleRecords.length === 0 ? (
                  <div className="empty">
                    <div className="empty-icon">
                      <Plus />
                    </div>
                    <b>Your {section.toLowerCase()} will appear here</b>
                    <span>
                      Add your first record to start building a useful business
                      history.
                    </span>
                    <button
                      className="secondary"
                      onClick={() => setShowCreate(true)}
                    >
                      Add your first {section.slice(0, -1).toLowerCase()}
                    </button>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Name / Reference</th>
                          <th>Details</th>
                          <th>Status</th>
                          <th>Value</th>
                          <th>Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRecords.map(item => (
                          <tr key={item.id}>
                            <td>
                              <b>
                                {String(
                                  item.name ||
                                    item.title ||
                                    item.client ||
                                    item.description ||
                                    'Untitled'
                                )}
                              </b>
                              <small>#{item.id.slice(0, 8)}</small>
                            </td>
                            <td>
                              {String(
                                item.email ||
                                  item.category ||
                                  item.dueDate ||
                                  item.description ||
                                  '—'
                              )}
                            </td>
                            <td>
                              <select
                                className="status-select"
                                value={String(item.status || 'Open')}
                                onChange={e =>
                                  updateStatus(item, e.target.value)
                                }
                              >
                                <option>Open</option>
                                <option>New</option>
                                <option>Contacted</option>
                                <option>Qualified</option>
                                <option>Quoted</option>
                                <option>Booked</option>
                                <option>In progress</option>
                                <option>Done</option>
                                <option>Draft</option>
                                <option>Sent</option>
                                <option>Paid</option>
                                <option>Overdue</option>
                                <option>Cancelled</option>
                              </select>
                            </td>
                            <td>{item.amount ? money(item.amount) : '—'}</td>
                            <td>{dateLabel(String(item.createdAt || ''))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
          {section === 'Messages' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">CUSTOMER COMMUNICATIONS</div>
                  <h1>Messages & approvals</h1>
                  <p>One shared message queue for the unified LeadLoop AI. Drafts are never sent automatically.</p>
                </div>
                <button className="secondary" onClick={refreshSection}><Activity size={16} /> Refresh</button>
              </div>
              <div className="panel table-panel">
                <div className="panel-head">
                  <div>
                    <h3>Message drafts</h3>
                    <p>{records.length} saved drafts in this workspace</p>
                  </div>
                  <Send size={18} />
                </div>
                {loading ? (
                  <div className="empty">Loading messages…</div>
                ) : visibleRecords.length === 0 ? (
                  <div className="empty">
                    <div className="empty-icon"><MessageSquareText /></div>
                    <b>No message drafts yet</b>
                    <span>Ask the unified AI to draft a WhatsApp or email reply for an existing lead or customer.</span>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Contact</th><th>Channel</th><th>Message draft</th><th>Status</th><th>Action</th></tr></thead>
                      <tbody>
                        {visibleRecords.map(item => (
                          <tr key={item.id}>
                            <td><b>{String(item.contactName || 'Contact')}</b><small>{String(item.recipient || '')}</small></td>
                            <td>{String(item.channel || '').toUpperCase()}</td>
                            <td><b>{String(item.subject || 'Customer message')}</b><small style={{ whiteSpace: 'pre-wrap', maxWidth: 320 }}>{String(item.body || '')}</small></td>
                            <td><span className="status-pill">{String(item.status || 'Unknown')}</span><small>{String(item.deliveryStatus || 'Not sent')}</small></td>
                            <td>
                              {item.status === 'Pending approval' ? (
                                <button className="secondary" onClick={() => approveMessage(item)} disabled={!isOwner || item.consentToContact !== true}>{isOwner ? 'Approve draft' : 'Owner approval required'}</button>
                              ) : item.channel === 'email' && item.status === 'Approved - awaiting connection' ? (
                                <div className="action-stack">
                                  <a className="secondary" href={'mailto:' + encodeURIComponent(String(item.recipient || '')) + '?subject=' + encodeURIComponent(String(item.subject || '')) + '&body=' + encodeURIComponent(String(item.body || ''))}>Open Gmail compose</a>
                                  <button className="secondary" onClick={() => markEmailSentManually(item)} disabled={!isOwner}>Mark sent manually</button>
                                  <small className="muted">Only after you press Send in Gmail</small>
                                </div>
                              ) : item.status === 'Sent (marked manually)' ? (
                                <small className="muted">Marked by user, not verified</small>
                              ) : (
                                <small className="muted">Not sent</small>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div className="panel analytics-note">
                <h3>Delivery connections</h3>
                <p>Email drafts use your device's email app through a pre-filled compose link. Review the recipient and content, then press Send yourself. Returning here lets an owner/admin mark the message as sent manually; that status is your confirmation and is not independently verified by Gmail. WhatsApp sending is still unavailable. A missing consent record blocks approval.</p>
              </div>
            </>
          )}
          {section === 'Team' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">PEOPLE & PERMISSIONS</div>
                  <h1>Your team</h1>
                  <p>
                    Invite people into this business and give them the right
                    access.
                  </p>
                </div>
                {isOwner && (
                  <button
                    className="primary"
                    onClick={() => setShowInvite(true)}
                  >
                    <Plus size={17} /> Invite employee
                  </button>
                )}
              </div>
              <div className="panel table-panel">
                <div className="panel-head">
                  <div>
                    <h3>Workspace members</h3>
                    <p>People with access to {workspace.name}</p>
                  </div>
                  <Users size={18} />
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Role</th>
                        <th>Access</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map(item => (
                        <tr key={item.id}>
                          <td>
                            <b>
                              {String(item.name || item.email || item.userId)}
                            </b>
                            <small>{String(item.email || '')}</small>
                          </td>
                          <td>{String(item.role)}</td>
                          <td>
                            <span className="status-pill">
                              Workspace member
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
          {section === 'Settings' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">WORKSPACE CONTROL</div>
                  <h1>Settings</h1>
                  <p>Business profile and access settings.</p>
                </div>
              </div>
              <div className="settings-grid">
                <div className="panel">
                  <h3>Business profile</h3>
                  <p className="muted">
                    Your workspace is configured for South African business
                    operations.
                  </p>
                  <div className="setting-line">
                    <span>Business name</span>
                    <b>{workspace.name}</b>
                  </div>
                  <div className="setting-line">
                    <span>Industry</span>
                    <b>{workspace.industry || 'Not set'}</b>
                  </div>
                  <div className="setting-line">
                    <span>Currency</span>
                    <b>ZAR · South African rand</b>
                  </div>
                  <div className="setting-line">
                    <span>Your role</span>
                    <b>{workspace.role}</b>
                  </div>
                </div>
                <div className="panel">
                  <h3>Trial access</h3>
                  <p className="muted">
                    Your trial includes all current LeadLoop features.
                  </p>
                  <div className="trial-big">
                    {trialDays} <small>days remaining</small>
                  </div>
                  <span className="status-pill">Full-feature trial</span>
                  <p className="muted">
                    Trial ends {dateLabel(workspace.trialEndsAt)}. Subscription
                    and billing options will be introduced before paid plans
                    launch.
                  </p>
                </div>
                <div className="panel">
                  <h3>Public enquiry form</h3>
                  <p className="muted">
                    Share a link so potential customers can send their details directly into this workspace as new leads.
                  </p>
                  {isOwner ? (
                    publicEnquiryUrl ? (
                      <>
                        <span className="status-pill">Form is enabled</span>
                        <div className="invite-link">
                          <span>Share this link with potential customers</span>
                          <code>{publicEnquiryUrl}</code>
                          <button className="secondary" onClick={() => navigator.clipboard.writeText(publicEnquiryUrl)}>
                            Copy enquiry link
                          </button>
                        </div>
                        <button className="secondary" onClick={() => managePublicEnquiry(false)} disabled={publicEnquiryBusy}>
                          {publicEnquiryBusy ? 'Disabling…' : 'Disable public form'}
                        </button>
                      </>
                    ) : (
                      <button className="primary" onClick={() => managePublicEnquiry(true)} disabled={publicEnquiryBusy}>
                        {publicEnquiryBusy ? 'Enabling…' : 'Enable public enquiry form'} <ArrowUpRight size={16} />
                      </button>
                    )
                  ) : (
                    <small className="muted">Only workspace owners and admins can manage this form.</small>
                  )}
                  <p className="muted">
                    Submissions create a New lead and an automatic review task. The form does not send replies or marketing messages.
                  </p>
                </div>
                <div className="panel whatsapp-integration-panel">
                  <div className="integration-title-row">
                    <div>
                      <div className="eyebrow">CUSTOMER-OWNED ACCOUNT</div>
                      <h3>WhatsApp Business</h3>
                    </div>
                    <span className="status-pill">{whatsappStatus?.connected ? 'Connected' : 'Not connected'}</span>
                  </div>
                  <p className="muted">
                    Each business connects its own WhatsApp Business account. You do not need to own or use WhatsApp Business personally to run LeadLoop.
                  </p>
                  <div className="whatsapp-benefits">
                    <div><b>One shared LeadLoop AI</b><span>Connected conversations will use the same AI and the correct business workspace.</span></div>
                    <div><b>Keep your own business number</b><span>Eligible accounts may be able to keep using the WhatsApp Business app through Meta Coexistence.</span></div>
                    <div><b>Customer data stays separate</b><span>Messages and contact records belong to the workspace that connected the account.</span></div>
                  </div>
                  {isOwner ? (
                    <button className="primary" disabled={!whatsappStatus?.canStartEmbeddedSignup} title="Meta Embedded Signup has not been configured for LeadLoop yet">
                      Connect WhatsApp
                    </button>
                  ) : (
                    <small className="muted">Only workspace owners and admins can manage integrations.</small>
                  )}
                  <div className="integration-setup-note">
                    <b>{whatsappStatus?.connected ? 'Account connection detected' : 'Meta setup required before connection'}</b>
                    <span>{whatsappStatus?.message || 'LeadLoop still needs its Meta developer app, Embedded Signup configuration, required permissions and webhook verification. Customers will connect their own accounts after that setup is approved.'}</span>
                  </div>
                  <p className="muted integration-disclaimer">
                    This is the connection setup area, not an active WhatsApp connection. No WhatsApp messages are being received or sent yet. A connected WhatsApp account also does not detect unanswered normal phone calls; that requires a separate phone-network integration.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <span className="eyebrow">NEW RECORD</span>
                <h2>{section === 'Calendar' ? 'New appointment' : 'Add ' + section.slice(0, -1)}</h2>
              </div>
              <button className="icon-btn" onClick={() => setShowCreate(false)}>
                <X />
              </button>
            </div>
            <label>
              {titleField === 'client' ? 'Client name' : 'Name'}
              <input
                value={form[titleField] || ''}
                onChange={e =>
                  setForm({ ...form, [titleField]: e.target.value })
                }
                placeholder={
                  titleField === 'client' ? 'Client or company' : 'Enter a name'
                }
              />
            </label>
            <label>
              Email / contact
              <input
                value={form.email || ''}
                onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="name@example.com"
              />
            </label>
            {section === 'Calendar' && (
              <>
                <label>Customer name<input value={form.client || ''} onChange={e => setForm({ ...form, client: e.target.value })} placeholder="Customer or patient name" /></label>
                <label>Service / appointment type<input value={form.service || ''} onChange={e => setForm({ ...form, service: e.target.value })} placeholder="Consultation, repair, haircut…" /></label>
                <div className="form-row">
                  <label>Starts<input type="datetime-local" required value={form.startAt || ''} onChange={e => setForm({ ...form, startAt: e.target.value })} /></label>
                  <label>Ends<input type="datetime-local" required value={form.endAt || ''} onChange={e => setForm({ ...form, endAt: e.target.value })} /></label>
                </div>
                <div className="form-row">
                  <label>Assigned staff<input value={form.assignedTo || ''} onChange={e => setForm({ ...form, assignedTo: e.target.value })} placeholder="Staff member (optional)" /></label>
                  <label>Location / room<input value={form.location || ''} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="Address, room or online" /></label>
                </div>
              </>
            )}
            {section === 'Customers' && (
              <>
                <div className="form-row">
                  <label>
                    Phone number
                    <input value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+27..." />
                  </label>
                  <label>
                    Company
                    <input value={form.company || ''} onChange={e => setForm({ ...form, company: e.target.value })} placeholder="Company name (optional)" />
                  </label>
                </div>
                <label>
                  Address
                  <input value={form.address || ''} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Customer or business address" />
                </label>
                <label>
                  Customer source
                  <select value={form.source || 'Manual entry'} onChange={e => setForm({ ...form, source: e.target.value })}>
                    <option>Manual entry</option><option>Website enquiry</option><option>Phone call</option><option>WhatsApp</option><option>Email</option><option>Referral</option><option>Walk-in</option><option>Other</option>
                  </select>
                </label>
              </>
            )}
            {section === 'Payments' && (
              <>
                <label>
                  Payment method
                  <select value={form.paymentMethod || ''} onChange={e => setForm({ ...form, paymentMethod: e.target.value })}>
                    <option value="">Select method</option><option>Bank transfer</option><option>Cash</option><option>Card</option><option>Payment provider</option><option>Other</option>
                  </select>
                </label>
                <div className="form-row">
                  <label>
                    Invoice ID (optional)
                    <input value={form.invoiceId || ''} onChange={e => setForm({ ...form, invoiceId: e.target.value })} placeholder="Exact invoice ID" />
                  </label>
                  <label>
                    Payment reference
                    <input value={form.reference || ''} onChange={e => setForm({ ...form, reference: e.target.value })} placeholder="Bank or receipt reference" />
                  </label>
                </div>
                <label>
                  Payment date
                  <input type="date" value={form.paymentDate || ''} onChange={e => setForm({ ...form, paymentDate: e.target.value })} />
                </label>
              </>
            )}
            <div className="form-row">
              <label>
                Amount (ZAR)
                <input
                  type="number"
                  min="0"
                  value={form.amount || ''}
                  onChange={e => setForm({ ...form, amount: e.target.value })}
                  placeholder="0.00"
                />
              </label>
              <label>
                Status
                <select
                  value={form.status || (section === 'Payments' ? 'Pending verification' : section === 'Calendar' ? 'Confirmed' : 'Open')}
                  onChange={e => setForm({ ...form, status: e.target.value })}
                >
                  <option>Open</option>
                  {section === 'Calendar' && <><option>Requested</option><option>Confirmed</option><option>In progress</option><option>Completed</option><option>Cancelled</option></>}
                  {section === 'Payments' && <option>Pending verification</option>}
                  {section === 'Payments' && <option>Received</option>}
                  {section === 'Payments' && <option>Refunded</option>}
                  <option>New</option>
                  <option>Contacted</option>
                  <option>Qualified</option>
                  <option>Draft</option>
                  <option>Sent</option>
                  <option>In progress</option>
                  <option>Done</option>
                </select>
              </label>
            </div>
            <label>
              Description / notes
              <textarea
                rows={3}
                value={form.description || ''}
                onChange={e =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="Add useful context…"
              />
            </label>
            <button
              className="primary full"
              onClick={saveRecord}
              disabled={loading}
            >
              {loading ? 'Saving…' : 'Save record'} <Check size={16} />
            </button>
          </div>
        </div>
      )}
      {showInvite && (
        <div className="modal-backdrop" onClick={() => setShowInvite(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <span className="eyebrow">GROW YOUR TEAM</span>
                <h2>Invite an employee</h2>
              </div>
              <button className="icon-btn" onClick={() => setShowInvite(false)}>
                <X />
              </button>
            </div>
            <label>
              Employee email
              <input
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="employee@business.co.za"
              />
            </label>
            <label>
              Role
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value)}
              >
                <option value="employee">Employee</option>
                <option value="manager">Manager</option>
                <option value="finance">Finance</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <button
              className="primary full"
              onClick={inviteMember}
              disabled={loading}
            >
              {loading ? 'Creating invitation…' : 'Create invitation link'}{' '}
              <ArrowUpRight size={16} />
            </button>
            {inviteUrl && (
              <div className="invite-link">
                <span>Share this secure invitation link</span>
                <code>{inviteUrl}</code>
                <button
                  className="secondary"
                  onClick={() => navigator.clipboard.writeText(inviteUrl)}
                >
                  Copy invitation link
                </button>
              </div>
            )}
            <small>
              LeadLoop creates the secure invitation. Send the link to the
              employee using your preferred channel.
            </small>
          </div>
        </div>
      )}
      {showAI && (
        <div className="ai-drawer-backdrop" onClick={() => setShowAI(false)}>
          <aside className="ai-drawer" onClick={e => e.stopPropagation()}>
            <div className="ai-drawer-head">
              <div className="ai-orb small">
                <Sparkles />
              </div>
              <div>
                <span className="eyebrow">LEADLOOP INTELLIGENCE</span>
                <h2>Your business assistant</h2>
              </div>
              <button className="icon-btn" onClick={() => setShowAI(false)}>
                <X />
              </button>
            </div>
            <div className="ai-context">
              <span>Workspace context</span>
              <b>
                {workspace.name} · {section}
              </b>
            </div>
            <div className="ai-chat">
              <div className="assistant-message">
                I can help you understand your business, organize priorities,
                draft customer messages and decide what to do next. I use the
                information available in this workspace.
              </div>
              {aiAnswer && (
                <div className="assistant-message answer">{aiAnswer}</div>
              )}
            </div>
            <div className="ai-compose">
              <textarea
                rows={3}
                value={aiQuestion}
                onChange={e => setAiQuestion(e.target.value)}
                placeholder="Ask about your leads, customers, cash flow…"
              />
              <button
                className="primary"
                onClick={askAI}
                disabled={aiBusy || !aiQuestion.trim()}
              >
                {aiBusy ? 'Thinking…' : 'Ask AI'} <Send size={16} />
              </button>
            </div>
            <small className="ai-disclaimer">
              AI can create and update workspace records when you request an authorized action. External messages, calls and payments are not sent or performed unless a connected service explicitly supports them.
            </small>
          </aside>
        </div>
      )}
    </div>
  );
}
