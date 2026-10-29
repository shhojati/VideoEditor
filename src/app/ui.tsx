import type { ButtonHTMLAttributes, ReactNode } from 'react';

const VARIANTS = {
  default: 'bg-surface-3 text-neutral-100 hover:bg-surface-4',
  /** The one main action on a bar (Export). */
  primary: 'bg-accent text-on-accent font-medium hover:bg-accent-strong',
  /** Toggled on (Snap, Pro): soft green fill with a green edge. */
  pill: 'border border-accent/50 bg-accent-soft text-accent hover:bg-accent/25',
  ghost: 'text-neutral-200 hover:bg-surface-3',
};

/** A caller's own font size (text-xs on the timeline toolbar, say) replaces the default one. */
const SIZED = /(^|\s)text-(xs|sm|base|lg|\[\d)/;

export type ButtonVariant = keyof typeof VARIANTS;

export function Button({ className = '', variant = 'default', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-40 md:h-8 md:px-2.5 ${SIZED.test(className) ? '' : 'text-sm md:text-[13px]'} ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function Panel({ title, children, className = '', hideTitle, actions }: { title: string; children: ReactNode; className?: string; hideTitle?: boolean; actions?: ReactNode }) {
  return (
    <section className={`flex min-h-0 min-w-0 flex-col bg-surface-1 md:rounded-lg md:border md:border-line ${className}`} aria-label={title}>
      {/* Phones: the mobile layout names panels in its own chrome, so the heading is for screen readers only. */}
      <div className={`flex items-center border-b border-line px-3 py-1.5 md:px-4 md:py-2.5 ${hideTitle ? 'sr-only' : 'max-md:sr-only'}`}>
        <h2 className="min-w-0 flex-1 truncate text-xs font-medium tracking-[0.15em] text-muted uppercase md:text-xs">{title}</h2>
        {actions}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}
