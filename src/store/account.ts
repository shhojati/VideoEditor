// The logged-in account (or none). Editing never needs it; exporting does (features/account/policy.ts).
import { create } from 'zustand';
import { api, type Me } from '../lib/api';

interface AccountState {
  /** 'offline': the API could not be reached; the editor works, export asks to retry. */
  status: 'loading' | 'ready' | 'offline';
  me: Me | null;
  /** The server has the built-in AI chat on (an AI key is set). */
  chat: boolean;
}

export const useAccount = create<AccountState>()(() => ({ status: 'loading', me: null, chat: false }));

let lastLoad = 0;

export async function loadAccount() {
  lastLoad = Date.now();
  try {
    const { user, chat } = await api<{ user: Me | null; chat?: boolean }>('/me');
    useAccount.setState({ status: 'ready', me: user, chat: !!chat });
  } catch {
    useAccount.setState((s) => ({ status: s.me ? 'ready' : 'offline' }));
  }
}

/** Re-reads the plan (e.g. after the owner activated Pro), at most once a minute unless forced. */
export function refreshAccount(force = false) {
  if (force || Date.now() - lastLoad > 60_000) void loadAccount();
}

export async function login(email: string, password: string) {
  const me = await api<Me>('/auth/login', { email, password });
  useAccount.setState({ status: 'ready', me });
}

export async function register(email: string, password: string) {
  const me = await api<Me>('/auth/register', { email, password });
  useAccount.setState({ status: 'ready', me });
}

export async function logout() {
  await api('/auth/logout', {}).catch(() => {});
  useAccount.setState({ status: 'ready', me: null });
}

export const changePassword = (current: string, next: string) => api('/auth/password', { current, next });

/** Starts loading the account and keeps the plan fresh when the tab regains focus. */
export function initAccount() {
  void loadAccount();
  window.addEventListener('focus', () => refreshAccount());
}

/** The balance after a chat turn charged it. */
export function setCredits(credits: number) {
  useAccount.setState((s) => (s.me ? { me: { ...s.me, credits } } : s));
}
