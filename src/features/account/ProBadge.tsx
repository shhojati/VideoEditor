import { useAccount } from '../../store/account';
import { isPro } from './policy';

/** The "PRO" tag on AI actions; hidden once the account has Pro, since they are then open. */
export function ProBadge() {
  const pro = useAccount((s) => isPro(s.me));
  return pro ? null : <span className="text-[10px] text-amber-300">PRO</span>;
}
