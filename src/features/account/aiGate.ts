// The Pro check for AI features, with the way forward: log in, or the account dialog to upgrade.
import { showToast } from '../../app/toasts';
import i18n from '../../i18n';
import { useAccount } from '../../store/account';
import { openAccount, openAuth } from './AccountDialogs';
import { aiAccess } from './policy';

/** True when the user may run an AI feature; otherwise opens the right dialog and says why. */
export function requireAi(): boolean {
  const access = aiAccess(useAccount.getState().me);
  if (access === 'ok') return true;
  showToast(i18n.t(`account.aiOnly.${access}`));
  if (access === 'login') openAuth();
  else openAccount();
  return false;
}
