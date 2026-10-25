import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CubeError, parseCube } from '../../lib/cube';
import { encodeLut } from '../../model/luts';
import { newId } from '../../model/factories';
import type { Project, ProjectLut } from '../../model/types';

const SIZE = 84;

/** A colour wheel: drag the dot from the centre towards a hue (further = stronger); double-click resets. */
export function WheelField({ label, x, y, onChange }: { label: string; x: number; y: number; onChange: (x: number, y: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    let dx = ((e.clientX - r.left) / r.width) * 2 - 1;
    let dy = -(((e.clientY - r.top) / r.height) * 2 - 1);
    const d = Math.hypot(dx, dy);
    if (d > 1) {
      dx /= d;
      dy /= d;
    }
    onChange(Math.round(dx * 1000) / 1000, Math.round(dy * 1000) / 1000);
  };
  return (
    <div className="flex items-center gap-3">
      <div
        ref={ref}
        role="slider"
        aria-label={label}
        aria-valuetext={`${Math.round(Math.hypot(x, y) * 100)}%`}
        data-testid="color-wheel"
        className="relative shrink-0 touch-none rounded-full"
        style={{
          width: SIZE,
          height: SIZE,
          // Hue around the circle (red at the right, counter-clockwise as in the maths), grey centre.
          background: 'radial-gradient(circle, #8a8a8a 0%, rgba(138,138,138,0) 70%), conic-gradient(from 90deg, #f00, #f0f, #00f, #0ff, #0f0, #ff0, #f00)',
        }}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          setDrag(true);
          at(e);
        }}
        onPointerMove={(e) => drag && at(e)}
        onPointerUp={() => setDrag(false)}
        onDoubleClick={() => onChange(0, 0)}
      >
        <span
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{ left: `${50 + x * 50}%`, top: `${50 - y * 50}%` }}
        />
      </div>
      <span className="text-xs text-neutral-300">{label}</span>
    </div>
  );
}

/** Choose one of the project's LUTs, or import a .cube file (stored in the project). */
export function LutField({
  label,
  value,
  luts,
  onChange,
}: {
  label: string;
  value: string;
  luts: Project['luts'];
  onChange: (id: string, add?: { id: string; lut: ProjectLut }) => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const entries = Object.entries(luts ?? {});
  const load = async (file: File) => {
    setError(null);
    try {
      const lut = encodeLut(file.name.replace(/\.cube$/i, ''), parseCube(await file.text()));
      const id = newId();
      onChange(id, { id, lut });
    } catch (e) {
      setError(e instanceof CubeError ? t('luts.badFile', { reason: e.message }) : t('luts.readFailed'));
    }
  };
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-xs">
        <span className="w-24 shrink-0 text-neutral-400">{label}</span>
        <select className="min-w-0 flex-1 rounded bg-surface-3 px-1 py-1" value={value} data-testid="lut-select" onChange={(e) => onChange(e.target.value)}>
          <option value="">{t('luts.none')}</option>
          {entries.map(([id, l]) => (
            <option key={id} value={id}>
              {id.startsWith('builtin:') ? t(`luts.names.${id.slice(8)}`, { defaultValue: l.name }) : l.name}
            </option>
          ))}
        </select>
      </label>
      <button className="rounded bg-surface-3 px-2 py-0.5 text-xs hover:bg-surface-4" onClick={() => input.current?.click()}>
        {t('luts.import')}
      </button>
      <input
        ref={input}
        type="file"
        accept=".cube"
        className="hidden"
        data-testid="lut-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void load(f);
        }}
      />
      {error && <p className="text-[11px] text-red-300">{error}</p>}
    </div>
  );
}
