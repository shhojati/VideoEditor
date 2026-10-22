// The Pro check for AI features, with the way forward: log in, or the account dialog to upgrade.
import { showToast } from '../../app/toasts';
import i18n from '../../i18n';
import { useAccount } from '../../store/account';
import { openAccount, openAuth } from './AccountDialogs';
import { aiAccess } from './policy';

/** The AI action that asked to log in; it runs as soon as a login gives access (see afterLogin). */
let pending: (() => void) | null = null;

/**
 * True when the user may run an AI feature; otherwise opens the right dialog and says why.
 * `retry` is the action itself: after logging in from here it continues without a second click.
 */
export function requireAi(retry?: () => void): boolean {
  const access = aiAccess(useAccount.getState().me);
  if (access === 'ok') return true;
  showToast(i18n.t(`account.aiOnly.${access}`));
  pending = access === 'login' ? (retry ?? null) : null;
  if (access === 'login') openAuth();
  else openAccount();
  return false;
}

/** Called once a login or registration went through: continue the waiting AI action, or say how to get Pro. */
export function afterLogin() {
  const action = pending;
  pending = null;
  if (!action) return;
  if (aiAccess(useAccount.getState().me) === 'ok') action();
  else requireAi();
}

/** The login dialog was closed without logging in: forget the waiting action. */
export const dropPendingAi = () => void (pending = null);
