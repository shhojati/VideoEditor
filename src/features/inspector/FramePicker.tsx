import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { readers } from '../../engine/decode/mediaReader';
import { mediaTimeAt } from '../../model/remap';
import type { Asset, Clip } from '../../model/types';
import { useTransport } from '../../store/transport';

const WIDTH = 260;

/**
 * The clip's own frame at the playhead, before any effect, to click a colour from (the key colour
 * of a green screen). A 3×3 average evens out compression noise.
 */
export function FramePicker({ clip, asset, onPick }: { clip: Clip; asset: Asset; onPick: (hex: string) => void }) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const reader = await readers.get(asset);
      const now = useTransport.getState().time;
      const at = Math.min(clip.start + clip.duration - 1e-3, Math.max(clip.start, now));
      const sample = asset.kind === 'video' ? await reader?.video?.getSample(mediaTimeAt(clip, at)) : null;
      const drawable = sample ?? reader?.imageAt(mediaTimeAt(clip, at));
      const c = canvas.current;
      if (!alive || !drawable || !c) {
        sample?.close();
        return;
      }
      c.width = WIDTH;
      c.height = Math.max(1, Math.round((WIDTH * drawable.displayHeight) / drawable.displayWidth));
      drawable.draw(c.getContext('2d', { willReadFrequently: true })!, 0, 0, c.width, c.height);
      sample?.close();
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [clip, asset]);

  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * c.width);
    const y = Math.round(((e.clientY - r.top) / r.height) * c.height);
    const d = c.getContext('2d')!.getImageData(Math.max(0, x - 1), Math.max(0, y - 1), 3, 3).data;
    const avg = [0, 1, 2].map((k) => {
      let s = 0;
      for (let i = k; i < d.length; i += 4) s += d[i];
      return Math.round(s / (d.length / 4));
    });
    onPick(`#${avg.map((v) => v.toString(16).padStart(2, '0')).join('')}`);
  };

  return (
    <div className="space-y-1">
      <canvas ref={canvas} className="w-full cursor-crosshair rounded" data-testid="frame-picker" data-ready={ready} onClick={pick} />
      <p className="text-[11px] text-neutral-400">{t('effects.pickHint')}</p>
    </div>
  );
}
