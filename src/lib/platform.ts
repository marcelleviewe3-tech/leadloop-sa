import { supabase } from './supabase';

type ApiResult<T = any> = { data: T };

async function request<T = any>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const endpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/leadloop-api?path=${encodeURIComponent(path)}`;
  const response = await fetch(endpoint, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return { data: result as T };
}

export const api = {
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, body: unknown) => request<T>('POST', path, body),
  put: <T = any>(path: string, body: unknown) => request<T>('PUT', path, body),
};

export const auth = {
  async getUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    const user = data.user;
    return user ? {
      userId: user.id,
      email: user.email || undefined,
      name: String(user.user_metadata?.full_name || user.user_metadata?.name || user.email || ''),
    } : null;
  },
  async signInWithRedirect() {
    const invite = window.location.hash.match(/^#\/join\?code=([^&/]+)/);
    if (invite) window.localStorage.setItem(pendingKey, decodeURIComponent(invite[1]));
    const email = window.prompt('Enter your email address. We will send you a secure sign-in link.');
    if (!email?.trim()) return;
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    });
    if (error) throw error;
    window.alert('Check your email for the secure LeadLoop sign-in link.');
  },
  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },
};

const pendingKey = 'leadloop_pending_invite';
export const invitesClient = {
  getPendingCode() {
    const fromStorage = window.localStorage.getItem(pendingKey);
    if (fromStorage) return fromStorage;
    const match = window.location.hash.match(/^#\/join(?:\?code=|\/)([^&/]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  },
  clearPendingCode() {
    window.localStorage.removeItem(pendingKey);
    if (window.location.hash.startsWith('#/join')) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  },
  buildJoinUrl(code: string, options?: { path?: string }) {
    const path = options?.path || '#/join';
    const url = `${window.location.origin}${window.location.pathname}${path}${path.includes('?') ? '&' : '?'}code=${encodeURIComponent(code)}`;
    window.localStorage.setItem(pendingKey, code);
    return url;
  },
};
