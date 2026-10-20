import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Button({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`rounded bg-surface-3 px-2.5 py-1 text-sm text-neutral-100 hover:bg-[#363c49] disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      {...props}
    />
  );
}

export function Panel({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`flex min-h-0 min-w-0 flex-col bg-surface-1 ${className}`} aria-label={title}>
      {/* Phones: the mobile layout names panels in its own chrome, so the heading is for screen readers only. */}
      <h2 className="border-b border-line px-3 py-1.5 text-xs font-medium tracking-wide text-neutral-400 uppercase max-md:sr-only">
        {title}
      </h2>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}
