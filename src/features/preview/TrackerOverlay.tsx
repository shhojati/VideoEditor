import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { boxToSample, mergeSamples, putSample, trackerBox, type RotatedBox } from '../../engine/render/motion';
import { isActiveAt } from '../../engine/render/renderFrame';
import { findClip } from '../../model/timeline';
import type { Project } from '../../model/types';
import { useProjectStore } from '../../store/projectStore';
import { useTimelineUi } from '../timeline/timelineUi';
import { useTracking } from '../tracking/trackingService';
import { corners, MIN_BOX, resizeBox, toWorld, type Pt } from './canvasGeometry';
import { usePreviewView } from './previewView';
import { mediaTimeAt } from '../../model/remap';

const HANDLE = 9;
let dragSeq = 0;

/**
 * The active tracker's box on the preview, while its clip is selected (inside the canvas overlay's SVG): drag it onto the
 * object, corners resize it (Alt: about the centre). Moving it sets the box for the frame under the
 * playhead, where the next tracking run starts. While a run is going it shows the live result.
 */
export function TrackerOverlay({ project, time }: { project: Project; time: number }) {
  const { t } = useTranslation();
  const active = useTracking((s) => s.active);
  const job = useTracking((s) => s.job);
  const view = usePreviewView((s) => s.view);
  const selection = useTimelineUi((s) => s.selection);
  const drag = useRef<{ start: Pt; box: RotatedBox; handle: { sx: number; sy: number } | null; key: string } | null>(null);

  const ref = active && time >= 0 ? findClip(project, active.clipId) : undefined;
  const tracker = ref?.clip.trackers?.find((x) => x.id === active!.trackerId);
  if (!ref || !tracker || !isActiveAt(ref.clip, time)) return null;
  const running = job?.trackerId === tracker.id;
  // Shown while its clip is selected (or being tracked), not over other clips' editing.
  if (!running && !selection.includes(ref.clip.id)) return null;
  const live = running ? { ...tracker, samples: mergeSamples(tracker.samples, job.fresh, job.from, job.dir) } : tracker;
  const box = trackerBox(project, ref.clip, live, time);
  if (!box) return null;
  const editable = !running && !ref.track.locked;
  const clipId = ref.clip.id;

  const toScreen = (p: Pt) => ({ x: view.ox + p.x * view.k, y: view.oy + p.y * view.k });
  const toProject = (e: React.PointerEvent) => {
    const r = (e.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.ox) / view.k, y: (e.clientY - r.top - view.oy) / view.k };
  };

  const begin = (e: React.PointerEvent, handle: { sx: number; sy: number } | null) => {
    if (!editable || e.button !== 0) return;
    // Not a click on a clip underneath.
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { start: toProject(e), box, handle, key: `tracker-box:${++dragSeq}` };
  };
  const move = (e: React.PointerEvent) => {
    const g = drag.current;
    if (!g) return;
    const p = toProject(e);
    const next: RotatedBox = g.handle
      ? resizeBox(g.box, g.handle.sx, g.handle.sy, p, false, e.altKey)
      : { ...g.box, cx: g.box.cx + p.x - g.start.x, cy: g.box.cy + p.y - g.start.y };
    if (next.w < MIN_BOX || next.h < MIN_BOX) return;
    useProjectStore.getState().edit(
      'ops.trackerBox',
      (d) => {
        const c = findClip(d, clipId)?.clip;
        const tr = c?.trackers?.find((x) => x.id === tracker.id);
        if (!c || !tr) return;
        const s = mediaTimeAt(c, time);
        const r = boxToSample(d, c, tr, time, s, next);
        if (!r) return;
        putSample(tr.samples, r.sample);
        tr.width = r.width;
        tr.height = r.height;
        delete tr.lostAt;
      },
      { mergeKey: g.key, gesture: true },
    );
  };
  const end = () => (drag.current = null);

  const pts = corners(box).map(toScreen);
  const centre = toScreen({ x: box.cx, y: box.cy });
  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end };
  return (
    <g data-testid="tracker-box" data-tracker-id={tracker.id}>
      <polygon
        points={pts.map((c) => `${c.x},${c.y}`).join(' ')}
        className={running ? 'fill-amber-300/10 stroke-amber-300' : 'fill-amber-300/5 stroke-amber-400'}
        strokeWidth={1.5}
        strokeDasharray={running ? undefined : '5 3'}
        style={{ pointerEvents: editable ? 'all' : 'none', cursor: editable ? 'move' : 'default' }}
        aria-label={t('tracking.boxHint')}
        onPointerDown={(e) => begin(e, null)}
        {...handlers}
      />
      <path d={`M${centre.x - 6},${centre.y}h12M${centre.x},${centre.y - 6}v12`} className="stroke-amber-300" style={{ pointerEvents: 'none' }} />
      <text x={pts[0].x} y={pts[0].y - 5} className="fill-amber-300 text-[11px]" style={{ pointerEvents: 'none' }}>
        {tracker.name}
      </text>
      {editable &&
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
          const c = toScreen(toWorld(box, { x: (sx * box.w) / 2, y: (sy * box.h) / 2 }));
          return (
            <rect
              key={`${sx}:${sy}`}
              data-testid="tracker-corner"
              x={c.x - HANDLE / 2}
              y={c.y - HANDLE / 2}
              width={HANDLE}
              height={HANDLE}
              className="fill-amber-200 stroke-amber-600"
              style={{ pointerEvents: 'all', cursor: sx === sy ? 'nwse-resize' : 'nesw-resize' }}
              onPointerDown={(e) => begin(e, { sx, sy })}
              {...handlers}
            />
          );
        })}
    </g>
  );
}
