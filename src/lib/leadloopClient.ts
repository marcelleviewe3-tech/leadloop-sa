import { createClient } from '@supabase/supabase-js';

// Public browser key only. Privileged service-role credentials stay inside Edge Functions.
const supabaseUrl = 'https://vaycxiafwtcjlrylctpj.supabase.co';
const supabaseKey = 'sb_publishable_GiJqGcpeszL6JV__dgYTwA_qTmWwnjj';

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

type LeadLoopUser = { userId: string; email?: string; name?: string };

export const auth = {
  async getUser(): Promise<LeadLoopUser | null> {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return {
      userId: data.user.id,
      email: data.user.email || undefined,
      name: String(data.user.user_metadata?.full_name || data.user.user_metadata?.name || ''),
    };
  },
  async signInWithMagicLink(email: string) {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    });
    if (error) throw error;
  },
  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },
};

async function request(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const url = new URL(supabaseUrl + '/functions/v1/leadloop-api');
  url.searchParams.set('path', path);
  const response = await fetch(url.toString(), {
    method,
    headers: {
      apikey: supabaseKey,
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let payload: any = {};
  try { payload = await response.json(); } catch { /* non-JSON response */ }
  if (!response.ok) throw new Error(payload.error || 'LeadLoop could not complete this request.');
  return { data: payload };
}

export const api = {
  get(path: string) { return request('GET', path); },
  post(path: string, body: unknown) { return request('POST', path, body); },
  put(path: string, body: unknown) { return request('PUT', path, body); },
};

const inviteStorageKey = 'leadloop.pendingInvite';
export const invitesClient = {
  getPendingCode(): string | null {
    const queryCode = new URLSearchParams(window.location.search).get('invite');
    const hashMatch = window.location.hash.match(/(?:join\/|invite=)([A-Za-z0-9-]+)/);
    const code = queryCode || hashMatch?.[1] || window.localStorage.getItem(inviteStorageKey);
    if (code) window.localStorage.setItem(inviteStorageKey, code);
    return code;
  },
  clearPendingCode() { window.localStorage.removeItem(inviteStorageKey); },
  buildJoinUrl(code: string, options?: { path?: string }) {
    const url = new URL(window.location.href);
    url.searchParams.set('invite', code);
    if (options?.path) url.hash = options.path;
    return url.toString();
  },
};
