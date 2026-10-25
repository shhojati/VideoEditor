import type { LucideIcon, LucideProps } from 'lucide-react';

export type { LucideIcon };

/** The app's line icons: one size and stroke everywhere, so every toolbar reads the same. */
export function Icon({ icon: I, size = 18, ...props }: LucideProps & { icon: LucideIcon }) {
  return <I size={size} strokeWidth={1.75} aria-hidden {...props} />;
}
