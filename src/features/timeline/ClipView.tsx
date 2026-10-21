import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Asset, Clip, Track } from '../../model/types';
import { useMedia } from '../media-bin/mediaService';
import { SHAPE_ICONS } from '../shapes/shapesUi';
import { clipKeyTimes } from '../../model/masks';
import { KeyDiamonds, VolumeLine } from '../keyframes/KeyDiamonds';
import { applyFx, canDropFx, fxDrag } from '../effects/effectActions';
import { useProjectStore } from '../../store/projectStore';
import { beginClipDrag } from './interactions';
import { TRACK_HEIGHT, useTimelineUi } from './timelineUi';
import { keyToTimeline, meanSpeed, mediaTimeAt, sourceRangeFor, timelineTimeAt } from '../../model/remap';

const COLORS = {
  video: 'bg-sky-800/90 border-sky-500',
  image: 'bg-indigo-800/90 border-indigo-400',
  audio: 'bg-emerald-900/90 border-emerald-500',
  text: 'bg-amber-800/90 border-amber-500',
  shape: 'bg-fuchsia-800/90 border-fuchsia-500',
  adjustment: 'bg-slate-600/80 border-slate-300 border-dashed',
};

interface Props {
  clip: Clip;
  track: Track;
  asset?: Asset;
  /** Visible time window, for drawing only what is on screen. */
  view: { t0: number; t1: number };
  pps: number;
  selected: boolean;
}

export const ClipView = memo(function ClipView({ clip, track, asset, view, pps, selected }: Props) {
  const preview = useTimelineUi((s) => s.drag?.clips[clip.id]);
  const dragValid = useTimelineUi((s) => s.drag?.valid ?? true);
  // While dragged to another track, the clip is drawn by that track's lane instead.
  if (preview && preview.trackId !== track.id) return null;
  return (
    <ClipBox
      clip={preview ? { ...clip, start: preview.start, duration: preview.duration } : clip}
      original={clip}
      track={track}
      asset={asset}
      view={view}
      pps={pps}
      selected={selected}
      ghost={!!preview}
      invalid={!!preview && !dragValid}
    />
  );
});

export function ClipBox(props: Props & { original: Clip; ghost?: boolean; invalid?: boolean }) {
  const { clip, original, track, asset, view, pps, selected, ghost, invalid } = props;
  const left = clip.start * pps;
  const width = Math.max(2, clip.duration * pps);
  const { t } = useTranslation();
  const kind = clip.adjustment ? 'adjustment' : clip.text ? 'text' : clip.shape ? 'shape' : (asset?.kind ?? 'video');
  const [fxHover, setFxHover] = useState(false);
  const live = clip.effects?.filter((e) => e.enabled) ?? [];
  // Only the on-screen part of the clip gets thumbnails / waveform.
  const visFrom = Math.max(clip.start, view.t0);
  const visTo = Math.min(clip.start + clip.duration, view.t1);

  return (
    <div
      data-testid="clip"
      data-clip-id={original.id}
      data-start={clip.start.toFixed(3)}
      data-duration={clip.duration.toFixed(3)}
      data-selected={selected}
      className={`absolute top-1 overflow-hidden rounded border text-[11px] text-white select-none ${COLORS[kind]} ${
        // Touch: a selected clip drags; an unselected one lets a swipe scroll the timeline.
        selected ? 'touch-none ring-2 ring-white' : ''
      } ${ghost ? 'opacity-80 shadow-lg' : ''} ${invalid ? 'border-red-500! ring-red-500' : ''} ${fxHover ? 'ring-2 ring-amber-300' : ''} ${
        track.locked ? 'cursor-not-allowed opacity-60' : 'cursor-grab'
      }`}
      style={{ left, width, height: TRACK_HEIGHT - 8 }}
      onPointerDown={(e) => !track.locked && beginClipDrag(e, original.id, 'move')}
      // Effects and filters dragged from their panes drop onto a clip.
      onDragOver={(e) => {
        const p = useProjectStore.getState().history?.present;
        if (!p || !canDropFx(p, original.id)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        setFxHover(true);
      }}
      onDragLeave={() => setFxHover(false)}
      onDrop={(e) => {
        setFxHover(false);
        if (!fxDrag.item) return;
        e.preventDefault();
        e.stopPropagation();
        applyFx(fxDrag.item, [original.id]);
        fxDrag.item = null;
      }}
    >
      {visTo > visFrom && kind === 'video' && <Filmstrip clip={clip} assetId={asset!.id} from={visFrom} to={visTo} pps={pps} />}
      {visTo > visFrom && (kind === 'audio' || kind === 'image') && (
        <ClipPreviewStrip clip={clip} asset={asset!} from={visFrom} to={visTo} pps={pps} />
      )}
      {asset?.beats && visTo > visFrom && <BeatTicks clip={clip} times={asset.beats.times} from={visFrom} to={visTo} pps={pps} />}
      <span className="pointer-events-none absolute start-1 top-0.5 max-w-full truncate rounded bg-black/50 px-1" dir="auto">
        {clip.adjustment
          ? `◫ ${t('effects.adjustment')}`
          : clip.shape
            ? `${SHAPE_ICONS[clip.shape.kind]} ${t(`shapes.${clip.shape.kind}`)}`
            : (clip.text?.content ?? asset?.name ?? '')}
      </span>
      {live.length > 0 && (
        <span
          data-testid="fx-badge"
          className="pointer-events-none absolute start-1 bottom-0.5 rounded bg-amber-500/80 px-1 text-[10px] font-semibold text-black"
          title={live.map((e) => t(`effects.names.${e.kind}`)).join(', ')}
        >
          fx{live.length > 1 ? ` ${live.length}` : ''}
        </span>
      )}
      {clip.audio.duck && (
        <span
          data-testid="duck-badge"
          className="pointer-events-none absolute end-1 bottom-0.5 rounded bg-sky-500/80 px-1 text-[10px] font-semibold text-black"
          title={t('inspector.duck')}
        >
          ↓ {clip.audio.duck.amount} dB
        </span>
      )}
      {(clip.trackers?.length || clip.motion) && (
        <span
          data-testid="motion-badge"
          className="pointer-events-none absolute end-1 top-0.5 rounded bg-amber-400/90 px-1 text-[10px] font-semibold text-black"
          title={clip.motion ? t({ stabilize: 'tracking.stabilize', follow: 'tracking.follow', reframe: 'reframe.title' }[clip.motion.mode]) : t('tracking.title')}
        >
          ⌖
        </span>
      )}
      {!!clip.masks?.length && (
        <span
          data-testid="mask-badge"
          className="pointer-events-none absolute top-0.5 rounded bg-yellow-300/90 px-1 text-[10px] font-semibold text-black"
          style={{ insetInlineEnd: clip.trackers?.length || clip.motion ? 20 : 4 }}
          title={t('masks.title')}
        >
          ◐
        </span>
      )}
      {clipKeyTimes(clip).map((s) => {
        const x = (keyToTimeline(clip, s) - clip.start) * pps;
        if (x < 0 || x > width) return null;
        return (
          <span
            key={s}
            data-testid="mask-keyframe"
            className="pointer-events-none absolute bottom-1 size-2 rotate-45 border border-black/60 bg-yellow-300"
            style={{ left: x - 4 }}
          />
        );
      })}
      {!!clip.keyframes?.length && (kind === 'audio' || (kind === 'video' && asset?.hasAudio)) && <VolumeLine clip={clip} width={width} pps={pps} />}
      {!!clip.keyframes?.length && <KeyDiamonds clip={clip} original={original} pps={pps} width={width} />}
      {clip.blend && clip.blend !== 'normal' && (
        <span
          data-testid="blend-badge"
          className="pointer-events-none absolute end-1 bottom-0.5 max-w-[60%] truncate rounded bg-black/60 px-1 text-[10px] text-neutral-200"
          title={t('blend.label')}
        >
          ◐ {t(`blend.${clip.blend}`)}
        </span>
      )}
      {!track.locked && (
        <>
          <div
            data-testid="trim-start"
            className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize touch-none hover:bg-white/60 pointer-coarse:w-3.5"
            onPointerDown={(e) => {
              e.stopPropagation();
              beginClipDrag(e, original.id, 'trim-start');
            }}
          />
          <div
            data-testid="trim-end"
            className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize touch-none hover:bg-white/60 pointer-coarse:w-3.5"
            onPointerDown={(e) => {
              e.stopPropagation();
              beginClipDrag(e, original.id, 'trim-end');
            }}
          />
        </>
      )}
    </div>
  );
}

interface StripProps {
  clip: Clip;
  from: number;
  to: number;
  pps: number;
}

/** Thumbnails tiled along the clip; each tile shows the cached frame nearest to its source time. */
function Filmstrip({ clip, assetId, from, to, pps }: StripProps & { assetId: string }) {
  const thumbs = useMedia((s) => s.assets[assetId]?.thumbs);
  if (!thumbs?.urls.length) return null;
  const h = TRACK_HEIGHT - 10;
  const tileW = (thumbs.width / thumbs.height) * h;
  const tileSec = tileW / pps;
  const first = Math.floor((from - clip.start) / tileSec);
  const tiles = [];
  for (let i = first; clip.start + i * tileSec < to; i++) {
    const srcTime = mediaTimeAt(clip, clip.start + (i + 0.5) * tileSec);
    let best = 0;
    for (let k = 1; k < thumbs.times.length; k++)
      if (Math.abs(thumbs.times[k] - srcTime) < Math.abs(thumbs.times[best] - srcTime)) best = k;
    tiles.push(
      <img
        key={i}
        src={thumbs.urls[best]}
        alt=""
        draggable={false}
        className="pointer-events-none absolute top-0 opacity-70"
        style={{ left: i * tileW, width: tileW, height: h }}
      />,
    );
  }
  return <>{tiles}</>;
}

/** Waveform (audio) or repeated still (image), drawn for the visible part only. */
function ClipPreviewStrip({ clip, asset, from, to, pps }: StripProps & { asset: Asset }) {
  const media = useMedia((s) => s.assets[asset.id]);
  const ref = useRef<HTMLCanvasElement>(null);
  const width = Math.ceil((to - from) * pps);
  const left = (from - clip.start) * pps;
  const h = TRACK_HEIGHT - 10;
  const peaks = media?.waveform;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !peaks || width <= 0) return;
    canvas.width = width;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(167, 243, 208, 0.75)';
    const buckets = peaks.peaks.length / 2;
    for (let x = 0; x < width; x++) {
      const { from: tA, to: tB } = sourceRangeFor(clip, from + x / pps, from + (x + 1) / pps);
      const a = Math.max(0, Math.floor(tA * peaks.peaksPerSecond));
      const b = Math.min(buckets, Math.max(a + 1, Math.floor(tB * peaks.peaksPerSecond)));
      let min = 0;
      let max = 0;
      for (let k = a; k < b; k++) {
        min = Math.min(min, peaks.peaks[2 * k]);
        max = Math.max(max, peaks.peaks[2 * k + 1]);
      }
      const y0 = ((1 - max) / 2) * h;
      ctx.fillRect(x, y0, 1, Math.max(1, ((max - min) / 2) * h));
    }
  }, [peaks, width, h, from, clip, pps]);

  if (asset.kind === 'image') {
    const url = media?.thumbs?.urls[0];
    return url ? (
      <div
        className="pointer-events-none absolute top-0 opacity-60"
        style={{ left, width, height: h, backgroundImage: `url(${url})`, backgroundSize: 'auto 100%' }}
      />
    ) : null;
  }
  return <canvas ref={ref} className="pointer-events-none absolute top-0" style={{ left, width, height: h }} />;
}

/** Detected beats as ticks along the bottom of a music clip (only the visible part). */
function BeatTicks({ clip, times, from, to, pps }: { clip: Clip; times: number[]; from: number; to: number; pps: number }) {
  const xs: number[] = [];
  for (const s of times) {
    const t = timelineTimeAt(clip, s);
    if (t >= from && t <= to) xs.push((t - clip.start) * pps);
  }
  // Too dense to read when zoomed far out: show every 4th beat.
  const step = pps * (times.length > 1 ? (times[1] - times[0]) / meanSpeed(clip) : 1) < 6 ? 4 : 1;
  const path = xs.filter((_, i) => i % step === 0).map((x) => `M${x.toFixed(1)} 0v6`).join('');
  return (
    <svg className="pointer-events-none absolute bottom-0 left-0 h-1.5 w-full" data-testid="beat-ticks" data-count={xs.length}>
      <path d={path} stroke="#facc15" strokeWidth={1.5} />
    </svg>
  );
}
