/** The Vidora leaf (same drawing as public/favicon.svg). */
export function Logo({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <path d="M12 52C10 28 26 10 56 8C50 22 36 40 12 52Z" fill="#7fdcb0" />
      <path d="M12 52C36 40 50 22 56 8C60 34 42 54 12 52Z" fill="#3fbf8a" />
      <path d="M12 52L5 59" stroke="#3fbf8a" strokeWidth={4} strokeLinecap="round" />
    </svg>
  );
}
