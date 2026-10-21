import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../app/ui';
import { createTrack } from '../../model/factories';
import { findClip, timelineDuration } from '../../model/timeline';
import type { Project, Track, TrackKind } from '../../model/types';
import { formatDuration } from '../../lib/time';
import { useProjectStore } from '../../store/projectStore';
import { useTransport } from '../../store/transport';
import { addText, deleteSelection, splitAtPlayhead, zoomBy, zoomToFit } from './actions';
import { ClipBox, ClipView } from './ClipView';
import { onLaneDragLeave, onLaneDragOver, onLaneDrop } from './interactions';
import { Ruler } from './Ruler';
import { SubtitleLane } from './SubtitleLane';
import { CutMarkers } from './CutMarkers';
import { ShapeMenu } from '../shapes/ShapeMenu';
import { onTransitionDragOver, onTransitionDrop } from '../transitions/transitionActions';
import { HEADER_WIDTH, RULER_HEIGHT, select, TRACK_HEIGHT, useTimelineUi } from './timelineUi';

const KINDS: TrackKind[] = ['video', 'audio', 'text'];
const KIND_COLOR: Record<TrackKind, string> = { video: 'bg-sky-500', audio: 'bg-emerald-500', text: 'bg-amber-500' };
/** Extra room after the last clip so there is always space to drop or drag to. */
const TAIL_SECONDS = 30;

/**
 * Time always runs left -> right, so the timeline is LTR even in the Persian UI.
 * Display order is top track first; the model stores bottom -> top.
 */
export function TimelinePanel({ project }: { project: Project }) {
  const { t } = useTranslation();
  const edit = useProjectStore((s) => s.edit);
  const snapping = useTimelineUi((s) => s.snapping);
  const hasSelection = useTimelineUi((s) => s.selection.length > 0);
  const duration = timelineDuration(project);

  useEffect(() => useTransport.setState({ duration }), [duration]);

  return (
    <section className="flex min-h-0 flex-1 flex-col border-t border-line bg-surface-1" aria-label={t('panels.timeline')}>
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5 text-xs max-md:flex-nowrap max-md:overflow-x-auto max-md:[scrollbar-width:none] max-md:*:shrink-0">
        {KINDS.map((kind) => (
          <Button
            key={kind}
            className="text-xs"
            onClick={() =>
              // Audio tracks stack at the bottom, visual tracks on top.
              edit('ops.addTrack', (p) => void (kind === 'audio' ? p.tracks.unshift(createTrack(kind)) : p.tracks.push(createTrack(kind))))
            }
          >
            {t('track.add', { kind: t(`track.${kind}`) })}
          </Button>
        ))}
        <Button className="text-xs" onClick={() => addText(t('text.default'))} data-testid="btn-add-text">
          T+ {t('text.add')}
        </Button>
        <ShapeMenu />
        <span className="mx-1 h-4 w-px bg-line" />
        <Button className="text-xs" onClick={splitAtPlayhead} title={`${t('timeline.split')} (S)`} data-testid="btn-split">
          ✂ {t('timeline.split')}
        </Button>
        <Button className="text-xs" disabled={!hasSelection} onClick={() => deleteSelection()} title={`${t('timeline.delete')} (Del)`}>
          🗑 {t('timeline.delete')}
        </Button>
        <Button
          className={`text-xs ${snapping ? 'bg-accent/40!' : ''}`}
          aria-pressed={snapping}
          onClick={() => useTimelineUi.setState({ snapping: !snapping })}
          title={t('timeline.snapHint')}
        >
          🧲 {t('timeline.snap')}
        </Button>
        <Timecode duration={duration} />
        <div className="ms-auto flex items-center gap-1" dir="ltr">
          <Button className="text-xs" onClick={() => zoomBy(1 / 1.5)} aria-label={t('timeline.zoomOut')}>
            −
          </Button>
          <Button className="text-xs" onClick={() => zoomBy(1.5)} aria-label={t('timeline.zoomIn')}>
            +
          </Button>
          <Button className="text-xs" onClick={zoomToFit}>
            {t('timeline.fit')}
          </Button>
        </div>
      </div>
      <TimelineBody project={project} duration={duration} />
    </section>
  );
}

function Timecode({ duration }: { duration: number }) {
  const time = useTransport((s) => s.time);
  return (
    <span className="ms-2 font-mono text-neutral-300" dir="ltr" data-testid="timecode">
      {formatDuration(Math.floor(time))}.{String(Math.floor((time % 1) * 100)).padStart(2, '0')} / {formatDuration(duration)}
    </span>
  );
}

function TimelineBody({ project, duration }: { project: Project; duration: number }) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const pps = useTimelineUi((s) => s.pps);
  const scrollX = useTimelineUi((s) => s.scrollX);
  const viewportWidth = useTimelineUi((s) => s.viewportWidth);
  const headerWidth = useTimelineUi((s) => s.headerWidth);
  const guide = useTimelineUi((s) => s.drag?.guide);
  const tracks = [...project.tracks].reverse();
  const laneWidth = Math.max((duration + TAIL_SECONDS) * pps, viewportWidth - headerWidth);
  // Visible window, quantised to quarter-viewport chunks plus a chunk of margin on each side, so
  // scrolling only re-renders clips when a chunk boundary is crossed.
  const chunk = viewportWidth / pps / 4;
  const c0 = Math.floor(scrollX / pps / chunk) - 1;
  const c1 = Math.ceil((scrollX + viewportWidth) / pps / chunk) + 1;
  const view = useMemo(() => ({ t0: c0 * chunk, t1: c1 * chunk }), [c0, c1, chunk]);

  // Keep the DOM scroll position and the store in sync (zoom changes scrollX programmatically).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && Math.abs(el.scrollLeft - scrollX) > 1) el.scrollLeft = scrollX;
  }, [scrollX, pps]);

  useEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => useTimelineUi.setState({ viewportWidth: el.clientWidth }));
    ro.observe(el);
    // Ctrl+wheel zooms around the pointer (non-passive so the page does not zoom).
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const x = e.clientX - el.getBoundingClientRect().left - useTimelineUi.getState().headerWidth;
      zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, Math.max(0, x));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  // Follow the playhead while playing.
  useEffect(
    () =>
      useTransport.subscribe((s) => {
        if (!s.playing) return;
        const { pps: z, scrollX: sx, viewportWidth: vw, headerWidth: hw } = useTimelineUi.getState();
        const x = s.time * z;
        if (x > sx + vw - hw - 40 || x < sx) useTimelineUi.setState({ scrollX: Math.max(0, x - 40) });
      }),
    [],
  );

  return (
    <div
      ref={scrollRef}
      dir="ltr"
      data-testid="timeline"
      className="relative min-h-0 flex-1 overflow-auto"
      onScroll={(e) => useTimelineUi.setState({ scrollX: e.currentTarget.scrollLeft })}
    >
      <div className="relative" style={{ width: headerWidth + laneWidth }}>
        <div className="sticky top-0 z-30 flex border-b border-line bg-surface-1" style={{ height: RULER_HEIGHT }}>
          <div className="sticky left-0 z-10 shrink-0 border-e border-line bg-surface-1" style={{ width: headerWidth }} />
          <div className="sticky" style={{ left: headerWidth }}>
            <Ruler />
          </div>
        </div>

        {project.subtitleTracks.map((st) => (
          <SubtitleLane key={st.id} track={st} view={view} pps={pps} />
        ))}
        {tracks.length === 0 && <div className="p-3 text-sm text-neutral-400">{t('track.empty')}</div>}
        {tracks.map((track) => (
          <TrackRow key={track.id} track={track} project={project} view={view} pps={pps} />
        ))}
        <NewTrackZone pps={pps} project={project} />

        <Playhead pps={pps} />
        {guide !== undefined && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-yellow-300"
            style={{ left: headerWidth + guide * pps }}
          />
        )}
      </div>
    </div>
  );
}

const TrackRow = memo(function TrackRow({
  track,
  project,
  view,
  pps,
}: {
  track: Track;
  project: Project;
  view: { t0: number; t1: number };
  pps: number;
}) {
  const edit = useProjectStore((s) => s.edit);
  const drag = useTimelineUi((s) => s.drag);
  const selection = useTimelineUi((s) => s.selection);
  // Virtualisation: only clips that intersect the visible window are mounted.
  const visible = track.clips.filter((c) => c.start < view.t1 && c.start + c.duration > view.t0);
  // Clips dragged here from another track.
  const incoming = Object.entries(drag?.clips ?? {}).filter(
    ([id, c]) => c.trackId === track.id && !track.clips.some((x) => x.id === id),
  );
  const assetGhost = drag?.asset && drag.asset.trackId === track.id ? drag.asset : undefined;

  return (
    <div className="flex border-b border-line" style={{ height: TRACK_HEIGHT }} data-testid="track" data-track-kind={track.kind}>
      <TrackHeader track={track} edit={edit} />
      <div
        data-lane
        data-track-id={track.id}
        className={`relative flex-1 ${track.locked ? 'bg-[repeating-linear-gradient(45deg,#15171c,#15171c_6px,#1a1d23_6px,#1a1d23_12px)]' : 'bg-surface-0'}`}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget && !e.shiftKey && !e.ctrlKey) select([]);
        }}
        onDragOver={(e) => onTransitionDragOver(e, project, track.id) || onLaneDragOver(e, track.id)}
        onDragLeave={onLaneDragLeave}
        onDrop={(e) => onTransitionDrop(e, project, track.id) || onLaneDrop(e, track.id)}
      >
        {visible.map((clip) => (
          <ClipView
            key={clip.id}
            clip={clip}
            track={track}
            asset={clip.assetId ? project.assets[clip.assetId] : undefined}
            view={view}
            pps={pps}
            selected={selection.includes(clip.id)}
          />
        ))}
        {incoming.map(([id, c]) => {
          const ref = findClip(project, id);
          if (!ref) return null;
          return (
            <ClipBox
              key={id}
              clip={{ ...ref.clip, start: c.start, duration: c.duration }}
              original={ref.clip}
              track={track}
              asset={ref.clip.assetId ? project.assets[ref.clip.assetId] : undefined}
              view={view}
              pps={pps}
              selected
              ghost
              invalid={!drag?.valid}
            />
          );
        })}
        {assetGhost && <AssetGhost start={assetGhost.start} duration={assetGhost.duration} pps={pps} />}
        <CutMarkers project={project} track={track} pps={pps} />
      </div>
    </div>
  );
});

function AssetGhost({ start, duration, pps }: { start: number; duration: number; pps: number }) {
  return (
    <div
      data-testid="drop-ghost"
      className="pointer-events-none absolute top-1 rounded border-2 border-dashed border-white/70 bg-white/15"
      style={{ left: start * pps, width: duration * pps, height: TRACK_HEIGHT - 8 }}
    />
  );
}

function NewTrackZone({ pps, project }: { pps: number; project: Project }) {
  const { t } = useTranslation();
  const ghost = useTimelineUi((s) => (s.drag?.asset && s.drag.asset.trackId === null ? s.drag.asset : undefined));
  const empty = project.tracks.every((tr) => tr.clips.length === 0);
  const headerWidth = useTimelineUi((s) => s.headerWidth);
  // Compact header = mobile layout, where media is added by tapping rather than dropping.
  const compact = headerWidth < HEADER_WIDTH;
  return (
    <div className="flex" style={{ height: TRACK_HEIGHT }}>
      <div className="sticky left-0 z-10 shrink-0 border-e border-line bg-surface-1" style={{ width: headerWidth }} />
      <div
        data-lane
        data-track-id=""
        data-testid="new-track-zone"
        className="relative flex-1"
        onDragOver={(e) => onLaneDragOver(e, null)}
        onDragLeave={onLaneDragLeave}
        onDrop={(e) => onLaneDrop(e, null)}
      >
        <span className="pointer-events-none sticky left-2 inline-block max-w-64 p-3 text-xs text-neutral-400">
          {empty ? t(compact ? 'timeline.tapHint' : 'timeline.dropHint') : !compact && t('timeline.newTrackHint')}
        </span>
        {ghost && <AssetGhost start={ghost.start} duration={ghost.duration} pps={pps} />}
      </div>
    </div>
  );
}

function TrackHeader({ track, edit }: { track: Track; edit: ReturnType<typeof useProjectStore.getState>['edit'] }) {
  const { t } = useTranslation();
  const flip = (key: 'muted' | 'locked') =>
    edit(key === 'muted' ? 'ops.toggleMute' : 'ops.toggleLock', (p) => {
      const tr = p.tracks.find((x) => x.id === track.id);
      if (tr) tr[key] = !tr[key];
    });
  const headerWidth = useTimelineUi((s) => s.headerWidth);
  const compact = headerWidth < HEADER_WIDTH;
  return (
    <div
      className={`sticky left-0 z-10 flex shrink-0 items-center border-e border-line bg-surface-2 text-xs ${compact ? 'gap-1 px-1' : 'gap-2 px-2'}`}
      style={{ width: headerWidth }}
      title={t(`track.${track.kind}`)}
    >
      <span className={`h-3 w-1 rounded ${KIND_COLOR[track.kind]}`} />
      <span className="min-w-0 flex-1 truncate">{!compact && t(`track.${track.kind}`)}</span>
      <Toggle label={t('track.mute')} on={track.muted} onClick={() => flip('muted')}>
        M
      </Toggle>
      <Toggle label={t('track.lock')} on={track.locked} onClick={() => flip('locked')}>
        L
      </Toggle>
      <button
        aria-label={t('track.remove')}
        title={t('track.remove')}
        className="rounded px-1 text-neutral-400 hover:bg-red-900/50 hover:text-red-200"
        onClick={() =>
          edit('ops.removeTrack', (p) => {
            p.tracks = p.tracks.filter((x) => x.id !== track.id);
          })
        }
      >
        ✕
      </button>
    </div>
  );
}

function Toggle(props: { label: string; on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      aria-label={props.label}
      aria-pressed={props.on}
      title={props.label}
      onClick={props.onClick}
      className={`w-6 rounded py-0.5 font-mono ${props.on ? 'bg-accent text-white' : 'bg-surface-3 text-neutral-400'}`}
    >
      {props.children}
    </button>
  );
}

/** Subscribes to the transport alone so playback does not re-render the whole timeline. */
function Playhead({ pps }: { pps: number }) {
  const time = useTransport((s) => s.time);
  const headerWidth = useTimelineUi((s) => s.headerWidth);
  return (
    <div
      data-testid="playhead"
      className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-red-500"
      style={{ left: headerWidth + time * pps }}
    >
      <div className="absolute -left-1.5 top-0 h-3 w-3 rotate-45 bg-red-500" />
    </div>
  );
}
