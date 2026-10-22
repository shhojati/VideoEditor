import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '../../lib/api';
import { useAccount } from '../../store/account';
import { afterLogin, dropPendingAi, requireAi } from './aiGate';
import { useAccountUi } from './AccountDialogs';

const user = (proUntil: number | null): Me => ({ id: 1, code: 'A1', email: 'a@b.c', isAdmin: false, plan: proUntil ? 'pro' : 'free', proUntil });

beforeEach(() => {
  useAccount.setState({ status: 'ready', me: null });
  useAccountUi.setState({ dialog: null });
});

describe('AI gate', () => {
  it('continues the action right after logging in with Pro', () => {
    const action = vi.fn();
    expect(requireAi(action)).toBe(false);
    expect(useAccountUi.getState().dialog).toBe('auth');
    useAccount.setState({ me: user(Date.now() + 86_400_000) });
    afterLogin();
    expect(action).toHaveBeenCalledTimes(1);
    afterLogin(); // only once
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('opens the account dialog instead when the account is Free', () => {
    const action = vi.fn();
    requireAi(action);
    useAccount.setState({ me: user(null) });
    useAccountUi.setState({ dialog: null });
    afterLogin();
    expect(action).not.toHaveBeenCalled();
    expect(useAccountUi.getState().dialog).toBe('account');
  });

  it('forgets the action when the login dialog is closed', () => {
    const action = vi.fn();
    requireAi(action);
    dropPendingAi();
    useAccount.setState({ me: user(Date.now() + 86_400_000) });
    afterLogin();
    expect(action).not.toHaveBeenCalled();
  });
});
