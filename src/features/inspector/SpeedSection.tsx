import { Snowflake } from 'lucide-react';
import { Icon } from '../../app/icons';
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { meanSpeed, SPEED_RANGE } from '../../model/remap';
import { normalizeCurve, setSpeedCurve, SPEED_PRESETS } from '../../model/speed';
import { setClipSpeed } from '../../model/timeline';
import type { Asset, Clip, SpeedPoint, SpeedPreset } from '../../model/types';
import { setKeepPitch } from '../../model/voiceFx';
import { freezeAtPlayhead, toggleReverse, useSpeedUi } from '../timeline/speedActions';
import type { SetFn } from './ClipInspector';
import { NumberField, Section } from './controls';
import { resetClipSection } from './resetActions';

const RAMPS = Object.keys(SPEED_PRESETS) as Exclude<SpeedPreset, 'custom'>[];
const QUICK = [0.25, 0.5, 1, 2, 4];

/** Speed, ramps (presets and a curve), reverse, freeze frame and keep pitch for a video or audio clip. */
export function SpeedSection({ clip, asset, audible, visual, set }: { clip: Clip; asset: Asset; audible: boolean; visual: boolean; set: SetFn }) {
  const { t } = useTranslation();
  const reversing = useSpeedUi((s) => s.reversing === clip.id);
  const error = useSpeedUi((s) => (s.error?.clipId === clip.id ? s.error.reason : undefined));
  const avg = meanSpeed(clip);
  const setSpeed = (v: number) => set('speed', (c, p) => void setClipSpeed(p, c.id, v));
  const setCurve = (curve: SpeedPoint[] | null, preset: SpeedPreset = 'custom') => set('speedCurve', (c, p) => void setSpeedCurve(p, c.id, curve, preset));

  return (
    <Section id="speed" title={t('speed.title')} onReset={() => resetClipSection(clip.id, 'speed')}>
      <NumberField label={t('inspector.speed')} value={clip.speedCurve ? Math.round(avg * 100) / 100 : clip.speed} min={SPEED_RANGE.min} max={SPEED_RANGE.max} step={0.05} unit="×" onChange={setSpeed} />
      <div className="flex flex-wrap gap-1 text-xs">
        {QUICK.map((s) => (
          <button key={s} className={`rounded px-2 py-0.5 ${!clip.speedCurve && clip.speed === s ? 'bg-accent text-on-accent' : 'bg-surface-3 hover:bg-surface-4'}`} onClick={() => setSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>

      <div className="text-[11px] text-neutral-400">{t('speed.ramps')}</div>
      <div className="grid grid-cols-4 gap-1 text-xs" role="radiogroup" aria-label={t('speed.ramps')}>
        <button role="radio" aria-checked={!clip.speedCurve} data-testid="speed-preset" data-kind="none" className={`rounded px-1 py-1 ${!clip.speedCurve ? 'bg-accent text-on-accent' : 'bg-surface-3 hover:bg-surface-4'}`} onClick={() => clip.speedCurve && setCurve(null)}>
          {t('speed.presets.none')}
        </button>
        {RAMPS.map((k) => (
          <button
            key={k}
            role="radio"
            aria-checked={clip.speedPreset === k}
            data-testid="speed-preset"
            data-kind={k}
            className={`rounded px-1 py-1 ${clip.speedPreset === k ? 'bg-accent text-on-accent' : 'bg-surface-3 hover:bg-surface-4'}`}
            onClick={() => setCurve(SPEED_PRESETS[k], k)}
          >
            {t(`speed.presets.${k}`)}
          </button>
        ))}
        <button role="radio" aria-checked={clip.speedPreset === 'custom'} data-testid="speed-preset" data-kind="custom" className={`rounded px-1 py-1 ${clip.speedPreset === 'custom' ? 'bg-accent text-on-accent' : 'bg-surface-3 hover:bg-surface-4'}`} onClick={() => setCurve(clip.speedCurve ?? [[0, clip.speed], [1, clip.speed]])}>
          {t('speed.presets.custom')}
        </button>
      </div>
      {clip.speedCurve && <CurveEditor curve={clip.speedCurve} onChange={(c) => setCurve(c)} />}

      <div className="flex flex-wrap gap-1 text-xs">
        <button className={`rounded px-2 py-1 disabled:opacity-40 ${asset.reverseOf ? 'bg-accent text-on-accent' : 'bg-surface-3 hover:bg-surface-4'}`} data-testid="reverse" aria-pressed={!!asset.reverseOf} disabled={reversing} onClick={() => void toggleReverse(clip.id)}>
          ⟲ {reversing ? t('speed.reversing') : t('speed.reverse')}
        </button>
        {asset.kind === 'video' && visual && (
          <button className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-2 py-1 hover:bg-surface-4" data-testid="freeze" title={t('speed.freezeHint')} onClick={() => freezeAtPlayhead(clip.id)}>
            <Icon icon={Snowflake} size={14} />
            {t('speed.freeze')}
          </button>
        )}
      </div>
      {error && <p className="text-[11px] text-red-300" role="alert">{t(`speed.errors.${error}`, { max: 180 })}</p>}

      {audible && (
        <label className="flex items-center gap-2 text-xs text-neutral-300">
          <input type="checkbox" data-testid="keep-pitch" checked={!!clip.audio.keepPitch} onChange={(e) => {
            const on = e.target.checked;
            set('keepPitch', (c) => setKeepPitch(c, on));
          }} />
          {t('inspector.keepPitch')}
        </label>
      )}
      {audible && clip.audio.keepPitch && (avg < 0.25 || avg > 4) && <p className="text-[11px] text-amber-300">{t('speed.extremePitch')}</p>}
    </Section>
  );
}

const W = 240;
const H = 90;
const PAD = 8;
// Speed on a log scale: 0.1× at the bottom, 10× at the top, 1× in the middle.
const yOf = (v: number) => PAD + (1 - (Math.log10(v) + 1) / 2) * (H - 2 * PAD);
const vOf = (y: number) => 10 ** ((1 - (y - PAD) / (H - 2 * PAD)) * 2 - 1);
const xOf = (u: number) => PAD + u * (W - 2 * PAD);
const uOf = (x: number) => (x - PAD) / (W - 2 * PAD);

/** Speed over the clip: drag points (the ends move up and down only), double-click to add or remove one. */
function CurveEditor({ curve, onChange }: { curve: SpeedPoint[]; onChange: (c: SpeedPoint[]) => void }) {
  const { t } = useTranslation();
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const move = (e: ReactPointerEvent) => {
    if (drag === null) return;
    const { x, y } = local(e);
    const next = curve.map((p) => [...p] as SpeedPoint);
    const last = curve.length - 1;
    const lo = drag === 0 ? 0 : curve[drag - 1][0] + 0.01;
    const hi = drag === last ? 1 : curve[drag + 1][0] - 0.01;
    next[drag] = [drag === 0 ? 0 : drag === last ? 1 : Math.min(hi, Math.max(lo, uOf(x))), Math.min(SPEED_RANGE.max, Math.max(SPEED_RANGE.min, vOf(y)))];
    onChange(next);
  };
  const path = curve.map(([u, v], i) => `${i ? 'L' : 'M'}${xOf(u).toFixed(1)} ${yOf(v).toFixed(1)}`).join('');
  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full touch-none rounded bg-surface-3"
      data-testid="speed-curve"
      aria-label={t('speed.curve')}
      onPointerMove={move}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
      onDoubleClick={(e) => {
        const { x, y } = local(e);
        const u = uOf(x);
        if (u <= 0.01 || u >= 0.99) return;
        onChange(normalizeCurve([...curve, [u, vOf(y)]]));
      }}
    >
      <line x1={PAD} x2={W - PAD} y1={yOf(1)} y2={yOf(1)} stroke="#4a5160" strokeDasharray="3 3" />
      <text x={W - PAD} y={yOf(1) - 3} textAnchor="end" fontSize="8" fill="#8b93a3">1×</text>
      <path d={path} fill="none" stroke="#a78bfa" strokeWidth={2} />
      {curve.map(([u, v], i) => (
        <circle
          key={i}
          cx={xOf(u)}
          cy={yOf(v)}
          r={5}
          fill={drag === i ? '#fff' : '#a78bfa'}
          className="cursor-grab"
          data-testid="speed-point"
          onPointerDown={(e) => {
            e.stopPropagation();
            (e.target as Element).setPointerCapture?.(e.pointerId);
            setDrag(i);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (i > 0 && i < curve.length - 1) onChange(curve.filter((_, k) => k !== i));
          }}
        >
          <title>{`${v.toFixed(2)}×`}</title>
        </circle>
      ))}
    </svg>
  );
}
