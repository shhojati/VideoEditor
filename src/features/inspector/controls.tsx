import { useId, useState, type ReactNode } from 'react';

/** Fade in/out presets shared by text and shape clips (s). */
export const FADE_PRESETS = [
  { key: 'none', value: 0 },
  { key: 'quick', value: 0.3 },
  { key: 'slow', value: 1 },
] as const;

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-b border-line px-3 py-3">
      <h3 className="text-xs font-medium tracking-wide text-neutral-400 uppercase">{title}</h3>
      {children}
    </section>
  );
}

/** Label above its controls: the inspector column is narrow. */
function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      {label && (
        <label htmlFor={htmlFor} className="text-neutral-400">
          {label}
        </label>
      )}
      <div className="flex min-w-0 items-center gap-2">{children}</div>
    </div>
  );
}

interface NumberProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Display = value × factor (e.g. 100 for percent). */
  factor?: number;
  unit?: string;
  onChange: (value: number) => void;
}

/** Slider + numeric box. The box accepts values typed outside the slider range only within min/max. */
export function NumberField({ label, value, min, max, step = 0.01, factor = 1, unit, onChange }: NumberProps) {
  const id = useId();
  const shown = Math.round(value * factor * 100) / 100;
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    setDraft(null);
    const n = Number(raw.replace(',', '.'));
    if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n / factor)));
  };
  return (
    <Row label={label} htmlFor={id}>
      <input
        type="range"
        className="min-w-0 flex-1 accent-accent"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <input
        id={id}
        dir="ltr"
        inputMode="decimal"
        className="w-14 rounded bg-surface-3 px-1 py-0.5 text-end"
        value={draft ?? String(shown)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(e.currentTarget.value);
          if (e.key === 'Escape') setDraft(null);
        }}
      />
      {unit && <span className="w-4 text-neutral-400">{unit}</span>}
    </Row>
  );
}

/** Colour picker; with `optional`, a checkbox turns the colour on/off (undefined = off). */
export function ColorField(props: {
  label: string;
  value: string | undefined;
  optional?: boolean;
  fallback?: string;
  onChange: (value: string | undefined) => void;
}) {
  const id = useId();
  const on = props.value !== undefined;
  return (
    <Row label={props.label} htmlFor={id}>
      {props.optional && (
        <input
          type="checkbox"
          checked={on}
          aria-label={props.label}
          onChange={(e) => props.onChange(e.target.checked ? (props.fallback ?? '#000000') : undefined)}
        />
      )}
      <input
        id={id}
        type="color"
        disabled={!on}
        className="h-6 w-10 cursor-pointer rounded border border-line bg-transparent disabled:opacity-30"
        value={props.value ?? props.fallback ?? '#000000'}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {/* Colours with alpha (e.g. a translucent box) keep their alpha when picked again. */}
      <span className="font-mono text-[10px] text-neutral-400" dir="ltr">
        {props.value ?? ''}
      </span>
    </Row>
  );
}

export function Segmented<T extends string | number>(props: {
  label: string;
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <Row label={props.label}>
      <div className="flex overflow-hidden rounded border border-line" role="radiogroup" aria-label={props.label}>
        {props.options.map((o) => (
          <button
            key={String(o.value)}
            role="radio"
            aria-checked={o.value === props.value}
            title={o.title}
            className={`px-2 py-0.5 ${o.value === props.value ? 'bg-accent text-white' : 'bg-surface-3 text-neutral-300 hover:bg-[#363c49]'}`}
            onClick={() => props.onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </Row>
  );
}

export function SelectField<T extends string | number>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <Row label={props.label} htmlFor={id}>
      <select
        id={id}
        className="min-w-0 flex-1 rounded bg-surface-3 px-2 py-1"
        value={props.value}
        onChange={(e) => {
          const raw = e.target.value;
          props.onChange((typeof props.value === 'number' ? Number(raw) : raw) as T);
        }}
      >
        {props.options.map((o) => (
          <option key={String(o.value)} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Row>
  );
}
