import { X } from 'lucide-react';
import { Icon } from '../../app/icons';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import { histogram, vectorscope, waveform } from '../../engine/render/scopes';

export const useScopes = create<{ open: boolean }>()(() => ({ open: false }));

const W = 160;
const H = 90;
/** Analysed picture size (the preview frame, downscaled). */
const AW = 256;
const AH = 144;
const INTERVAL_MS = 100;

/** Grey levels from counts on a log scale, tinted. */
function paint(ctx: CanvasRenderingContext2D, counts: Uint32Array, w: number, h: number, tint: [number, number, number]) {
  let max = 1;
  for (const c of counts) if (c > max) max = c;
  const img = ctx.createImageData(w, h);
  const lmax = Math.log1p(max);
  for (let i = 0; i < counts.length; i++) {
    const v = counts[i] ? 0.25 + (0.75 * Math.log1p(counts[i])) / lmax : 0;
    img.data[i * 4] = tint[0] * v;
    img.data[i * 4 + 1] = tint[1] * v;
    img.data[i * 4 + 2] = tint[2] * v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** Histogram, waveform and vectorscope of the preview frame, updated ~10 times a second while open. */
export function Scopes() {
  const { t } = useTranslation();
  const open = useScopes((s) => s.open);
  const hist = useRef<HTMLCanvasElement>(null);
  const wave = useRef<HTMLCanvasElement>(null);
  const vec = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!open) return;
    const work = document.createElement('canvas');
    work.width = AW;
    work.height = AH;
    const wctx = work.getContext('2d', { willReadFrequently: true })!;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < INTERVAL_MS || document.hidden) return;
      last = now;
      const preview = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]');
      const frame = document.querySelector('[data-testid=preview-frame]')?.getBoundingClientRect();
      if (!preview || !frame || frame.width <= 0) return;
      const r = preview.getBoundingClientRect();
      const k = preview.width / Math.max(1, r.width);
      wctx.drawImage(preview, (frame.left - r.left) * k, (frame.top - r.top) * k, frame.width * k, frame.height * k, 0, 0, AW, AH);
      const px = wctx.getImageData(0, 0, AW, AH).data;

      const h = histogram(px);
      const hc = hist.current?.getContext('2d');
      if (hc) {
        hc.fillStyle = '#000';
        hc.fillRect(0, 0, W, H);
        hc.globalCompositeOperation = 'lighter';
        const peak = Math.max(1, ...h.r, ...h.g, ...h.b);
        ([['r', '#f44'], ['g', '#4f4'], ['b', '#48f']] as const).forEach(([c, color]) => {
          hc.fillStyle = color;
          h[c].forEach((n, i) => {
            const bar = (Math.sqrt(n / peak) * H) | 0;
            if (bar) hc.fillRect((i * W) / 256, H - bar, W / 256 + 0.5, bar);
          });
        });
        hc.globalCompositeOperation = 'source-over';
      }
      const wc = wave.current?.getContext('2d');
      if (wc) paint(wc, waveform(px, AW, AH, W, H), W, H, [140, 255, 160]);
      const vc = vec.current?.getContext('2d');
      if (vc) {
        paint(vc, vectorscope(px, H), H, H, [255, 255, 255]);
        vc.strokeStyle = 'rgba(255,255,255,0.25)';
        vc.beginPath();
        vc.arc(H / 2, H / 2, H / 2 - 1, 0, Math.PI * 2);
        vc.stroke();
        // Skin-tone line (about 123° in the usual vectorscope orientation).
        vc.strokeStyle = 'rgba(255,200,150,0.5)';
        vc.beginPath();
        vc.moveTo(H / 2, H / 2);
        vc.lineTo(H / 2 - 0.26 * H, H / 2 - 0.4 * H);
        vc.stroke();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  if (!open) return null;
  return (
    <div className="absolute bottom-2 left-2 z-20 flex gap-1 rounded bg-black/70 p-1 text-[10px] text-neutral-300" data-testid="scopes">
      <figure>
        <canvas ref={hist} width={W} height={H} className="block" />
        <figcaption>{t('scopes.histogram')}</figcaption>
      </figure>
      <figure>
        <canvas ref={wave} width={W} height={H} className="block" />
        <figcaption>{t('scopes.waveform')}</figcaption>
      </figure>
      <figure>
        <canvas ref={vec} width={H} height={H} className="block" data-testid="vectorscope" />
        <figcaption>{t('scopes.vectorscope')}</figcaption>
      </figure>
      <button className="self-start px-1 text-neutral-400 hover:text-white" aria-label={t('scopes.close')} onClick={() => useScopes.setState({ open: false })}>
        <Icon icon={X} size={14} />
      </button>
    </div>
  );
}
