import { Film, Image, Music, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { Icon } from '../../app/icons';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ACCEPT_ATTR } from '../../engine/decode/classify';
import { formatBytes, formatDuration } from '../../lib/time';
import type { Asset } from '../../model/types';
import { useMobileUi } from '../../app/layout';
import { addAssetAtPlayhead } from '../timeline/interactions';
import { assetDrag, useTimelineUi } from '../timeline/timelineUi';
import { relinkAsset, removeAsset, useMedia, type AssetMediaState } from './mediaService';

const KIND_ICON: Record<Asset['kind'], LucideIcon> = { video: Film, audio: Music, image: Image };

export function AssetCard({ asset }: { asset: Asset }) {
  const { t } = useTranslation();
  const state = useMedia((s) => s.assets[asset.id]);
  const relinkRef = useRef<HTMLInputElement>(null);
  const status = state?.status ?? 'checking';
  const audioUnsupported = asset.kind === 'video' && !!asset.codecs?.audio && !asset.hasAudio;

  const details = [
    asset.width && asset.height ? `${asset.width}×${asset.height}` : null,
    asset.fps ? `${asset.fps} fps` : null,
    [asset.codecs?.video, asset.codecs?.audio].filter(Boolean).join(' / ') || null,
    asset.size ? formatBytes(asset.size) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const onRelink = async (file: File) => {
    let result = await relinkAsset(asset, file);
    if (result === 'durationMismatch' && window.confirm(t('media.relink.durationMismatch'))) {
      result = await relinkAsset(asset, file, true);
    }
    if (result !== 'ok' && result !== 'durationMismatch') {
      window.alert(
        result === 'kindMismatch' ? t('media.relink.kindMismatch') : t(`media.errors.${result}`, { codec: '?' }),
      );
    }
  };

  return (
    <li
      draggable={status !== 'missing'}
      onDragStart={(e) => {
        assetDrag.assetId = asset.id;
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/x-video-editor-asset', asset.id);
      }}
      onDragEnd={() => {
        assetDrag.assetId = null;
        useTimelineUi.setState({ drag: null });
      }}
      className="group relative cursor-grab overflow-hidden rounded bg-surface-2 text-xs"
      data-testid="asset-card"
      data-status={status}
      data-kind={asset.kind}
      title={`${asset.name}\n${details}`}
    >
      <div className="relative flex aspect-video items-center justify-center bg-black" dir="ltr">
        <Preview asset={asset} state={state} />
        {status === 'missing' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/75 p-1 text-center">
            <span className="text-amber-300">{t('media.missing')}</span>
            <button
              className="rounded bg-amber-600 px-2 py-0.5 text-white hover:bg-amber-500"
              onClick={() => relinkRef.current?.click()}
            >
              {t('media.relink.action')}
            </button>
            <input
              ref={relinkRef}
              type="file"
              hidden
              accept={ACCEPT_ATTR}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void onRelink(f);
              }}
            />
          </div>
        )}
        {(status === 'processing' || status === 'checking') && (
          <div className="absolute end-1 top-1 h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        )}
        {asset.duration !== undefined && (
          <span className="absolute end-1 bottom-1 rounded bg-black/70 px-1 font-mono text-[10px]">
            {formatDuration(asset.duration)}
          </span>
        )}
        <span className="absolute start-1 bottom-1 flex items-center rounded-md bg-black/60 p-0.5 text-neutral-200">
          <Icon icon={KIND_ICON[asset.kind]} size={12} />
        </span>
      </div>
      <div className="flex items-center gap-1 px-1.5 py-1">
        <span className="min-w-0 flex-1 truncate" dir="auto">
          {asset.name}
        </span>
        {audioUnsupported && (
          <span className="flex text-amber-400" title={t('media.warnings.audioCodec', { codec: asset.codecs?.audio })}>
            <Icon icon={TriangleAlert} size={14} />
          </span>
        )}
        {status !== 'missing' && (
          <button
            className="rounded px-1 text-neutral-400 opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-white focus:opacity-100 pointer-coarse:px-2 pointer-coarse:py-1 pointer-coarse:opacity-100"
            aria-label={`${t('media.addToTimeline')}: ${asset.name}`}
            title={t('media.addToTimeline')}
            data-testid="asset-add"
            onClick={() => {
              addAssetAtPlayhead(asset.id);
              // Mobile: drop the sheet so the new clip is visible on the timeline.
              useMobileUi.setState({ sheet: null });
            }}
          >
            +
          </button>
        )}
        <button
          className="rounded-md px-1 text-neutral-400 opacity-0 group-hover:opacity-100 hover:bg-red-900/50 hover:text-red-200 focus:opacity-100 pointer-coarse:px-2 pointer-coarse:py-1 pointer-coarse:opacity-100"
          aria-label={`${t('media.remove')} ${asset.name}`}
          title={t('media.remove')}
          onClick={() => removeAsset(asset.id)}
        >
          <Icon icon={X} size={14} />
        </button>
      </div>
    </li>
  );
}

function Preview({ asset, state }: { asset: Asset; state?: AssetMediaState }) {
  if (state?.thumbs?.urls.length) {
    // The middle frame represents a clip better than the first.
    const url = state.thumbs.urls[Math.floor(state.thumbs.urls.length / 3)];
    return <img src={url} alt="" className="h-full w-full object-contain" draggable={false} />;
  }
  if (state?.waveform) return <Waveform peaks={state.waveform.peaks} />;
  return <Icon icon={KIND_ICON[asset.kind]} size={28} className="opacity-40" />;
}

/** Whole-file overview: buckets are folded down to the canvas width. */
function Waveform({ peaks }: { peaks: Float32Array }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = (canvas.width = 260);
    const h = (canvas.height = 146);
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#34d399';
    const buckets = peaks.length / 2;
    for (let x = 0; x < w; x++) {
      const from = Math.floor((x / w) * buckets);
      const to = Math.max(from + 1, Math.floor(((x + 1) / w) * buckets));
      let min = 0;
      let max = 0;
      for (let b = from; b < to; b++) {
        min = Math.min(min, peaks[2 * b]);
        max = Math.max(max, peaks[2 * b + 1]);
      }
      const y0 = ((1 - max) / 2) * h;
      const y1 = ((1 - min) / 2) * h;
      ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
  }, [peaks]);
  return <canvas ref={ref} className="h-full w-full" data-testid="waveform" />;
}
