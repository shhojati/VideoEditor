import { useEffect, useRef } from 'react';
import { formatDuration } from '../../lib/time';
import { useProjectStore } from '../../store/projectStore';
import { useTransport } from '../../store/transport';
import { removeMarker } from './beatActions';
import { RULER_HEIGHT, useTimelineUi } from './timelineUi';

/** Pointer distance (px) at which the ruler snaps to, or picks, a marker. */
const MARKER_PX = 6;
const NO_MARKERS: { id: string; t: number; color?: string }[] = [];

/** Tick spacing that keeps labels at least ~70px apart. */
const STEPS = [1 / 30, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];

/** Canvas ruler covering only the visible window; dragging on it scrubs the playhead. Markers sit on it. */
export function Ruler() {
  const ref = useRef<HTMLCanvasElement>(null);
  const markers = useProjectStore((s) => s.history?.present.markers ?? NO_MARKERS);
  const pps = useTimelineUi((s) => s.pps);
  const scrollX = useTimelineUi((s) => s.scrollX);
  const width = useTimelineUi((s) => s.viewportWidth - s.headerWidth);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = RULER_HEIGHT * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, RULER_HEIGHT);
    const major = STEPS.find((s) => s * pps >= 70) ?? 3600;
    const minor = major / 5;
    const t0 = scrollX / pps;
    const t1 = (scrollX + width) / pps;
    ctx.font = '10px Inter, sans-serif';
    ctx.textBaseline = 'top';
    for (let i = Math.floor(t0 / minor); i * minor <= t1; i++) {
      const t = i * minor;
      const x = Math.round(t * pps - scrollX) + 0.5;
      const isMajor = i % 5 === 0;
      ctx.fillStyle = isMajor ? '#8b93a3' : '#4a5160';
      ctx.fillRect(x, isMajor ? 12 : 18, 1, RULER_HEIGHT);
      if (isMajor) ctx.fillText(major < 1 ? `${formatDuration(Math.floor(t))}.${String(Math.round((t % 1) * 100)).padStart(2, '0')}` : formatDuration(t), x + 3, 2);
    }
    // Markers: a small flag at the bottom of the ruler.
    for (const m of markers) {
      if (m.t < t0 - 1 || m.t > t1 + 1) continue;
      const x = Math.round(m.t * pps - scrollX) + 0.5;
      ctx.fillStyle = m.color ?? '#facc15';
      ctx.beginPath();
      ctx.moveTo(x - 5, RULER_HEIGHT - 10);
      ctx.lineTo(x + 5, RULER_HEIGHT - 10);
      ctx.lineTo(x, RULER_HEIGHT);
      ctx.fill();
    }
  }, [pps, scrollX, width, markers]);

  const timeAt = (e: React.MouseEvent<HTMLCanvasElement>) => (e.clientX - e.currentTarget.getBoundingClientRect().left + scrollX) / pps;
  const markerNear = (t: number) => markers.find((m) => Math.abs(m.t - t) * pps <= MARKER_PX);
  // Scrubbing snaps to markers.
  const scrub = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const t = timeAt(e);
    useTransport.getState().seek(markerNear(t)?.t ?? t);
  };

  return (
    <canvas
      ref={ref}
      data-testid="ruler"
      style={{ width, height: RULER_HEIGHT }}
      className="block cursor-ew-resize touch-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        useTransport.getState().pause();
        scrub(e);
      }}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && scrub(e)}
      onDoubleClick={(e) => {
        const m = markerNear(timeAt(e));
        if (m) removeMarker(m.id);
      }}
    />
  );
}
