import { useTranslation } from 'react-i18next';
import { timelineTime, volumeAt } from '../../model/keyframes';
import type { Clip } from '../../model/types';
import { useTransport } from '../../store/transport';
import { TRACK_HEIGHT } from '../timeline/timelineUi';
import { beginKeyDrag } from './keyframeService';

/**
 * Keyframe diamonds on a timeline clip: press to put the playhead on one, drag to retime it. The
 * one under the playhead is highlighted. `clip` may be a drag preview of `original`.
 */
export function KeyDiamonds({ clip, original, pps, width }: { clip: Clip; original: Clip; pps: number; width: number }) {
  const { t } = useTranslation();
  const keys = clip.keyframes ?? [];
  const times = keys.map((k) => timelineTime(clip, k.t));
  const xs = times.map((x) => (x - clip.start) * pps);
  // Re-renders only when the highlighted diamond changes.
  const active = useTransport((s) => times.findIndex((x) => Math.abs(x - s.time) < 0.02));
  return (
    <>
      {xs.map((x, i) => {
        if (x < -1 || x > width + 1) return null;
        return (
          <span
            key={i}
            data-testid="clip-keyframe"
            data-active={i === active}
            title={t('keyframes.diamond')}
            className="absolute top-1/2 z-10 flex size-4 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center pointer-coarse:size-6"
            style={{ left: x - 8 }}
            onPointerDown={(e) => beginKeyDrag(e, original.id, i)}
          >
            <span className={`size-2.5 rotate-45 border border-black/70 ${i === active ? 'bg-sky-300' : 'bg-white'}`} />
          </span>
        );
      })}
    </>
  );
}

/** The clip's volume over time (0 % at the bottom, 200 % at the top) when it has keyframes. */
export function VolumeLine({ clip, width, pps }: { clip: Clip; width: number; pps: number }) {
  const h = TRACK_HEIGHT - 10;
  const pts: string[] = [];
  // Long clips at high zoom: at most ~2000 points.
  const step = Math.max(4, width / 2000);
  for (let x = 0; x <= width + step; x += step) {
    const px = Math.min(x, width);
    const v = volumeAt(clip, clip.start + px / pps);
    pts.push(`${px.toFixed(1)},${(h * (1 - Math.min(2, v) / 2)).toFixed(1)}`);
    if (px === width) break;
  }
  return (
    <svg className="pointer-events-none absolute top-0 left-0" width={width} height={h} data-testid="volume-line">
      <polyline points={pts.join(' ')} fill="none" stroke="rgb(253 224 71)" strokeWidth={1.5} />
    </svg>
  );
}
