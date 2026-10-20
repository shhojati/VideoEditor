import { useTranslation } from 'react-i18next';
import { Button, Panel } from '../../app/ui';
import { createTrack } from '../../model/factories';
import type { Project, TrackKind } from '../../model/types';
import { useProjectStore } from '../../store/projectStore';

const KINDS: TrackKind[] = ['video', 'audio', 'text'];

/**
 * Track headers only; ruler, clips, zoom and scrubbing arrive in Phase 3.
 * Time always runs left -> right, so the timeline is LTR even in the Persian UI.
 */
export function TimelinePanel({ project }: { project: Project }) {
  const { t } = useTranslation();
  const edit = useProjectStore((s) => s.edit);
  // Display top track first; the model stores bottom -> top.
  const tracks = [...project.tracks].reverse();

  return (
    <Panel title={t('panels.timeline')} className="flex-1 border-t border-line">
      <div className="flex gap-1 border-b border-line px-2 py-1.5">
        {KINDS.map((kind) => (
          <Button
            key={kind}
            className="text-xs"
            onClick={() => edit('ops.addTrack', (p) => void p.tracks.push(createTrack(kind)))}
          >
            {t('track.add', { kind: t(`track.${kind}`) })}
          </Button>
        ))}
      </div>
      {tracks.length === 0 && <div className="p-3 text-sm text-neutral-500">{t('track.empty')}</div>}
      <ul dir="ltr" data-testid="track-list">
        {tracks.map((track) => (
          <li key={track.id} className="flex h-12 items-stretch border-b border-line">
            <div className="flex w-56 shrink-0 items-center gap-2 border-e border-line bg-surface-2 px-2 text-xs">
              <span className={`h-3 w-1 rounded ${KIND_COLOR[track.kind]}`} />
              <span className="flex-1">{t(`track.${track.kind}`)}</span>
              <Toggle
                label={t('track.mute')}
                on={track.muted}
                onClick={() => edit('ops.toggleMute', (p) => flip(p, track.id, 'muted'))}
              >
                M
              </Toggle>
              <Toggle
                label={t('track.lock')}
                on={track.locked}
                onClick={() => edit('ops.toggleLock', (p) => flip(p, track.id, 'locked'))}
              >
                L
              </Toggle>
              <button
                aria-label={t('track.remove')}
                title={t('track.remove')}
                className="rounded px-1 text-neutral-500 hover:bg-red-900/50 hover:text-red-200"
                onClick={() =>
                  edit('ops.removeTrack', (p) => {
                    p.tracks = p.tracks.filter((x) => x.id !== track.id);
                  })
                }
              >
                ✕
              </button>
            </div>
            <div className="flex-1 bg-surface-0" />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

const KIND_COLOR: Record<TrackKind, string> = { video: 'bg-sky-500', audio: 'bg-emerald-500', text: 'bg-amber-500' };

function flip(p: Project, trackId: string, key: 'muted' | 'locked') {
  const track = p.tracks.find((x) => x.id === trackId);
  if (track) track[key] = !track[key];
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
