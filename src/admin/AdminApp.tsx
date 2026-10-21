import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../app/ui';
import { AccountDialogs, formatDate, formatToman, openAuth } from '../features/account/AccountDialogs';
import { api, ApiError, type AdminUser, type Grant } from '../lib/api';
import { logout, useAccount } from '../store/account';

export function AdminApp() {
  const { t, i18n } = useTranslation();
  const me = useAccount((s) => s.me);
  const status = useAccount((s) => s.status);
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 text-sm">
      <header className="flex items-center gap-2">
        <h1 className="text-lg font-semibold text-white">{t('admin.title')}</h1>
        <a className="text-xs text-accent hover:underline" href="/">
          {t('admin.open')}
        </a>
        <div className="ms-auto flex gap-2">
          {me && (
            <Button onClick={() => void logout()}>
              {t('account.logout')} <span dir="ltr">({me.email})</span>
            </Button>
          )}
          <Button onClick={() => void i18n.changeLanguage(i18n.language === 'fa' ? 'en' : 'fa')}>
            {i18n.language === 'fa' ? 'English' : 'فارسی'}
          </Button>
        </div>
      </header>
      {status === 'loading' ? null : me?.isAdmin ? (
        <Admin />
      ) : (
        <div className="space-y-2 rounded border border-line bg-surface-1 p-4">
          <p>{t('admin.needAdmin')}</p>
          {!me && <Button onClick={openAuth}>{t('account.login')}</Button>}
        </div>
      )}
      <AccountDialogs />
    </div>
  );
}

const fetchLists = (query: string) =>
  Promise.all([
    api<{ users: AdminUser[] }>(`/admin/users?q=${encodeURIComponent(query)}`).then((r) => r.users),
    api<{ grants: Grant[] }>('/admin/grants').then((r) => r.grants),
  ]);

function Admin() {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const report = (e: unknown) =>
    setMessage(t(`account.errors.${e instanceof ApiError ? e.code : 'network'}`, { defaultValue: String(e) }));

  const show = ([u, g]: [AdminUser[], Grant[]]) => {
    setUsers(u);
    setGrants(g);
  };
  const load = (query: string) => fetchLists(query).then(show, report);

  useEffect(() => {
    void fetchLists('').then(show, report);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- first load only; actions reload after
  }, []);

  const search = (e: FormEvent) => {
    e.preventDefault();
    void load(q);
  };

  const act = async (fn: () => Promise<unknown>) => {
    setMessage(null);
    try {
      await fn();
      await load(q);
    } catch (e) {
      report(e);
    }
  };

  const date = (ms: number) => formatDate(ms, i18n.language);

  return (
    <>
      <form className="flex gap-2" onSubmit={search}>
        <input
          className="flex-1 rounded bg-surface-3 px-2 py-1.5"
          dir="ltr"
          placeholder={t('admin.search')}
          aria-label={t('admin.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="admin-search"
        />
        <Button type="submit">{t('admin.refresh')}</Button>
      </form>
      {message && (
        <p className="rounded border border-amber-700 bg-amber-900/40 p-2 text-xs text-amber-100 select-all" role="status" data-testid="admin-message">
          {message}
        </p>
      )}

      <section className="space-y-2">
        <h2 className="font-medium text-white">{t('admin.users')}</h2>
        {users.length === 0 && <p className="text-neutral-400">{t('admin.noUsers')}</p>}
        {users.map((u) => (
          <UserRow
            key={u.id}
            user={u}
            date={date}
            onGrant={(months, amountToman, note) =>
              confirm(t('admin.confirmGrant', { months, email: u.email })) &&
              void act(() => api(`/admin/users/${u.id}/grant`, { months, amountToman, note }))
            }
            onRevoke={() =>
              confirm(t('admin.confirmRevoke', { email: u.email })) && void act(() => api(`/admin/users/${u.id}/revoke`, {}))
            }
            onReset={() =>
              confirm(t('admin.confirmReset', { email: u.email })) &&
              void act(async () => {
                const { password } = await api<{ password: string }>(`/admin/users/${u.id}/reset-password`, {});
                // Shown after the list reloads (act clears the message first).
                setTimeout(() => setMessage(t('admin.tempPassword', { email: u.email, password })));
              })
            }
          />
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium text-white">{t('admin.grants')}</h2>
        <table className="w-full text-xs">
          <tbody>
            {grants.map((g) => (
              <tr key={g.id} className="border-b border-line/60">
                <td className="py-1">{date(g.createdAt)}</td>
                <td className="py-1 font-mono" dir="ltr">
                  {g.code}
                </td>
                <td className="py-1" dir="ltr">
                  {g.email}
                </td>
                <td className="py-1">{g.months ? t('account.months', { count: g.months }) : t('admin.revoked')}</td>
                <td className="py-1">{g.amountToman ? t('account.toman', { price: formatToman(g.amountToman, i18n.language) }) : ''}</td>
                <td className="py-1 text-neutral-400">{g.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function UserRow({
  user: u,
  date,
  onGrant,
  onRevoke,
  onReset,
}: {
  user: AdminUser;
  date: (ms: number) => string;
  onGrant: (months: number, amountToman: number, note: string) => void;
  onRevoke: () => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const [months, setMonths] = useState(1);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const plan =
    u.plan === 'pro'
      ? t('admin.pro', { date: date(u.proUntil!) })
      : u.proUntil
        ? t('admin.expired', { date: date(u.proUntil) })
        : t('admin.free');
  return (
    <div className="space-y-2 rounded border border-line bg-surface-1 p-3" data-testid="admin-user">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-white" dir="ltr">
          {u.code}
        </span>
        <span dir="ltr">{u.email}</span>
        <span className={u.plan === 'pro' ? 'text-emerald-300' : 'text-neutral-400'} data-testid="admin-plan">
          {plan}
        </span>
        <span className="text-xs text-neutral-500">
          {t('admin.created')}: {date(u.createdAt)}
          {u.lastLoginAt ? ` · ${t('admin.lastLogin')}: ${date(u.lastLoginAt)}` : ''}
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-neutral-400">{t('admin.months')}</span>
          <select className="rounded bg-surface-3 px-2 py-1" value={months} onChange={(e) => setMonths(Number(e.target.value))} data-testid="admin-months">
            {[1, 2, 3, 6, 12].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-neutral-400">{t('admin.amount')}</span>
          <input className="w-32 rounded bg-surface-3 px-2 py-1" dir="ltr" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-neutral-400">{t('admin.note')}</span>
          <input className="min-w-32 rounded bg-surface-3 px-2 py-1" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <Button className="bg-accent! text-white" onClick={() => onGrant(months, Number(amount || 0), note)} data-testid="admin-grant">
          {t('admin.grant')}
        </Button>
        {u.plan === 'pro' && <Button onClick={onRevoke}>{t('admin.revoke')}</Button>}
        <Button onClick={onReset}>{t('admin.resetPassword')}</Button>
      </div>
    </div>
  );
}
