import { useTranslation } from 'react-i18next';
import { clipsWithTracker } from '../../engine/render/motion';
import { isOverlay } from '../../model/overlays';
import type { Clip, MotionLink, Project, Tracker } from '../../model/types';
import { Section } from '../inspector/controls';
import { select } from '../timeline/timelineUi';
import {
  addTracker,
  allTrackers,
  attachToTracker,
  cancelTracking,
  coverObject,
  deleteTracker,
  detach,
  renameTracker,
  setActiveTracker,
  setLink,
  stabilize,
  startTracking,
  useTracking,
} from './trackingService';
import { timelineTimeAt } from '../../model/remap';

const btn = 'rounded bg-surface-3 px-2 py-1 text-xs hover:bg-[#363c49] disabled:opacity-40';
const seconds = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

/** Display name of a clip in pickers. */
function clipName(project: Project, clip: Clip, t: (k: string) => string) {
  if (clip.adjustment) return t('effects.adjustment');
  if (clip.text) return clip.text.content.split('\n')[0].slice(0, 30) || t('inspector.textClip');
  if (clip.shape) return t('inspector.shapeClip');
  return (clip.assetId && project.assets[clip.assetId]?.name) || '?';
}

/** A video clip's trackers: add, place the box, track, and use the motion. */
export function TrackingSection({ project, clip }: { project: Project; clip: Clip }) {
  const { t } = useTranslation();
  const active = useTracking((s) => s.active);
  const job = useTracking((s) => s.job);
  const error = useTracking((s) => s.error);
  const trackers = clip.trackers ?? [];
  const current = active?.clipId === clip.id ? trackers.find((x) => x.id === active.trackerId) : undefined;
  const newName = () => t('tracking.objectN', { n: trackers.length + 1 });

  return (
    <Section title={t('tracking.title')}>
      <div data-testid="tracking-section" className="space-y-2">
        {!trackers.length && <p className="text-xs text-neutral-400">{t('tracking.intro')}</p>}
        {trackers.map((tr) => (
          <TrackerRow key={tr.id} clip={clip} tracker={tr} selected={tr.id === current?.id} />
        ))}
        <button className={btn} data-testid="tracker-add" onClick={() => addTracker(clip.id, newName())}>
          {trackers.length ? t('tracking.addAnother') : t('tracking.add')}
        </button>
        {current && (
          <div className="space-y-2 rounded border border-amber-500/40 p-2">
            <p className="text-[11px] text-neutral-400">{t('tracking.boxHint')}</p>
            {job?.trackerId === current.id ? (
              <div className="flex items-center gap-2" data-testid="tracking-progress">
                <div className="h-1.5 flex-1 rounded bg-surface-3">
                  <div className="h-1.5 rounded bg-amber-400" style={{ width: `${Math.round(job.progress * 100)}%` }} />
                </div>
                <span className="text-[11px] text-neutral-300">{t('tracking.running', { pct: Math.round(job.progress * 100) })}</span>
                <button className={btn} onClick={cancelTracking}>
                  {t('tracking.cancel')}
                </button>
              </div>
            ) : (
              <div className="flex gap-1" dir="ltr">
                <button className={`${btn} flex-1`} data-testid="track-backward" disabled={!!job} onClick={() => startTracking(clip.id, current.id, -1)}>
                  {t('tracking.back')}
                </button>
                <button className={`${btn} flex-1`} data-testid="track-forward" disabled={!!job} onClick={() => startTracking(clip.id, current.id, 1)}>
                  {t('tracking.forward')}
                </button>
              </div>
            )}
            {error && !job && <p className="text-[11px] text-red-300">{t(`tracking.errors.${error}`)}</p>}
            <UseMotion project={project} clip={clip} tracker={current} />
          </div>
        )}
      </div>
    </Section>
  );
}

function TrackerRow({ clip, tracker, selected }: { clip: Clip; tracker: Tracker; selected: boolean }) {
  const { t } = useTranslation();
  const toTimeline = (s: number) => timelineTimeAt(clip, s);
  const first = tracker.samples[0];
  const last = tracker.samples[tracker.samples.length - 1];
  const tracked = tracker.samples.length > 1;
  return (
    <div className={`rounded px-1.5 py-1 ${selected ? 'bg-amber-500/10' : ''}`} data-testid="tracker-row">
      <div className="flex items-center gap-1">
        <input
          type="radio"
          checked={selected}
          aria-label={t('tracking.select')}
          title={t('tracking.select')}
          onChange={() => setActiveTracker(clip.id, tracker.id)}
        />
        <input
          className="min-w-0 flex-1 rounded bg-surface-3 px-1.5 py-0.5 text-xs"
          dir="auto"
          aria-label={t('tracking.name')}
          value={tracker.name}
          onFocus={() => setActiveTracker(clip.id, tracker.id)}
          onChange={(e) => renameTracker(clip.id, tracker.id, e.target.value)}
        />
        <button className="rounded px-1.5 text-neutral-300 hover:bg-surface-3" aria-label={t('tracking.delete')} title={t('tracking.delete')} onClick={() => deleteTracker(clip.id, tracker.id)}>
          ✕
        </button>
      </div>
      <p className="mt-0.5 text-[11px] text-neutral-400" data-testid="tracker-range">
        {tracked ? t('tracking.range', { from: seconds(toTimeline(first[0])), to: seconds(toTimeline(last[0])) }) : t('tracking.notTracked')}
      </p>
      {tracker.lostAt !== undefined && <p className="text-[11px] text-amber-300">{t('tracking.lost', { at: seconds(toTimeline(tracker.lostAt)) })}</p>}
    </div>
  );
}

/** Attach another clip, stabilize this one, or cover the object. */
function UseMotion({ project, clip, tracker }: { project: Project; clip: Clip; tracker: Tracker }) {
  const { t } = useTranslation();
  const candidates = project.tracks.flatMap((track) =>
    track.kind === 'audio' || track.locked
      ? []
      : track.clips.filter((c) => c.id !== clip.id && (isOverlay(c) || (c.assetId && project.assets[c.assetId]?.kind !== 'audio'))),
  );
  const stabilized = clip.motion?.mode === 'stabilize' && clip.motion.trackerId === tracker.id;
  return (
    <div className="space-y-1.5 border-t border-line pt-2">
      <p className="text-[11px] font-medium text-neutral-400 uppercase">{t('tracking.use')}</p>
      <select
        className="w-full min-w-0 rounded bg-surface-3 px-2 py-1 text-xs"
        data-testid="tracker-attach"
        value=""
        aria-label={t('tracking.attach')}
        onChange={(e) => e.target.value && attachToTracker(e.target.value, clip.id, tracker.id)}
      >
        <option value="">{t('tracking.attach')}</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {clipName(project, c, t)}
            {c.motion?.trackerId === tracker.id ? ' ✓' : ''}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-1">
        <button className={btn} data-testid="tracker-stabilize" disabled={stabilized} onClick={() => stabilize(clip.id, tracker.id)}>
          {t('tracking.stabilize')}
        </button>
        <button className={btn} data-testid="tracker-blur" onClick={() => coverObject(clip.id, tracker.id, 'blur', t('masks.nameN', { n: 1 }))}>
          {t('tracking.blur')}
        </button>
        <button className={btn} data-testid="tracker-pixelate" onClick={() => coverObject(clip.id, tracker.id, 'pixelate', t('masks.nameN', { n: 1 }))}>
          {t('tracking.pixelate')}
        </button>
      </div>
    </div>
  );
}

/** A clip's link to a tracker: which parts it follows (or stabilizes), or pick a tracker to follow. */
export function MotionSection({ project, clip }: { project: Project; clip: Clip }) {
  const { t } = useTranslation();
  const link = clip.motion;
  const options = allTrackers(project).filter((x) => x.clip.id !== clip.id && !clip.trackers?.some((o) => o.id === x.tracker.id));
  if (!link && !options.length) return null;
  const source = link && clipsWithTracker(project, link.trackerId)[0];
  const parts: (keyof Pick<MotionLink, 'position' | 'rotation' | 'scale'>)[] = ['position', 'rotation', 'scale'];
  return (
    <Section title={t('tracking.follow')}>
      <div data-testid="motion-section" className="space-y-2">
        {link ? (
          <>
            <p className="text-xs text-neutral-200">
              {t(link.mode === 'stabilize' ? 'tracking.stabilized' : 'tracking.follows', { name: source?.tracker.name ?? '?' })}
              {source && link.mode === 'follow' && (
                <button className="ms-1 text-accent underline" onClick={() => select([source.clip.id])}>
                  {clipName(project, source.clip, t)}
                </button>
              )}
            </p>
            <div className="flex flex-wrap gap-3 text-xs">
              {parts.map((k) => (
                <label key={k} className="flex items-center gap-1">
                  <input type="checkbox" data-testid={`motion-${k}`} checked={link[k]} onChange={(e) => setLink(clip.id, { [k]: e.target.checked })} />
                  {t(`tracking.${k}`)}
                </label>
              ))}
            </div>
            <p className="text-[11px] text-neutral-400">{t(link.mode === 'stabilize' ? 'tracking.stabilizeHint' : 'tracking.followHint')}</p>
            <button className={btn} data-testid="motion-detach" onClick={() => detach(clip.id)}>
              {t('tracking.detach')}
            </button>
          </>
        ) : (
          <select
            className="w-full min-w-0 rounded bg-surface-3 px-2 py-1 text-xs"
            data-testid="motion-follow"
            value=""
            aria-label={t('tracking.followPick')}
            onChange={(e) => {
              const hit = options.find((x) => x.tracker.id === e.target.value);
              if (hit) attachToTracker(clip.id, hit.clip.id, hit.tracker.id);
            }}
          >
            <option value="">{t('tracking.followPick')}</option>
            {options.map((x) => (
              <option key={x.tracker.id} value={x.tracker.id}>
                {x.tracker.name} — {clipName(project, x.clip, t)}
              </option>
            ))}
          </select>
        )}
      </div>
    </Section>
  );
}
