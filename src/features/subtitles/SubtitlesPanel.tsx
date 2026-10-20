import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../app/ui';
import { addCue, cueAt, lintCues, mergeWithNext, setCueEdge, setCueText, splitCue, type CueIssue } from '../../model/subtitles';
import type { Cue, Project, SubtitleTrack } from '../../model/types';
import { useProjectStore } from '../../store/projectStore';
import { useTransport } from '../../store/transport';
import { formatTimecode } from '../preview/TransportBar';
import { select, useTimelineUi } from '../timeline/timelineUi';
import { AutoSubtitles } from './AutoSubtitles';
import {
  addSubtitleTrack,
  exportSubtitleFile,
  fixTiming,
  importSubtitleFile,
  removeSubtitleTrack,
  SUBTITLE_LANGUAGES,
} from './subtitleActions';
import { useSubtitlesUi } from './subtitlesUi';

const edit = (...args: Parameters<ReturnType<typeof useProjectStore.getState>['edit']>) =>
  useProjectStore.getState().edit(...args);

export function SubtitlesPanel({ project }: { project: Project }) {
  const { t } = useTranslation();
  const activeId = useSubtitlesUi((s) => s.activeTrackId);
  const track = project.subtitleTracks.find((x) => x.id === activeId) ?? project.subtitleTracks[0];
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newLang, setNewLang] = useState<string>('fa');

  return (
    <div className="flex min-h-full flex-col gap-2 p-2 text-xs" data-testid="subtitles-panel">
      <div className="flex flex-wrap items-center gap-1">
        {project.subtitleTracks.length > 0 && (
          <select
            aria-label={t('subtitles.track')}
            className="min-w-0 flex-1 rounded bg-surface-3 px-2 py-1"
            value={track?.id}
            onChange={(e) => useSubtitlesUi.setState({ activeTrackId: e.target.value })}
          >
            {project.subtitleTracks.map((st, i) => (
              <option key={st.id} value={st.id}>
                {i + 1}. {t(`subtitles.languages.${st.language}`, st.language)} ({st.cues.length})
              </option>
            ))}
          </select>
        )}
        <select aria-label={t('subtitles.language')} className="rounded bg-surface-3 px-1 py-1" value={newLang} onChange={(e) => setNewLang(e.target.value)}>
          {SUBTITLE_LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {t(`subtitles.languages.${l}`)}
            </option>
          ))}
        </select>
        <Button className="text-xs" onClick={() => addSubtitleTrack(newLang)} data-testid="add-subtitle-track">
          + {t('subtitles.newTrack')}
        </Button>
      </div>

      <div className="flex flex-wrap gap-1">
        <Button className="text-xs" onClick={() => fileRef.current?.click()}>
          {t('subtitles.import')}
        </Button>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".srt,.vtt,text/vtt,application/x-subrip"
          data-testid="subtitle-file-input"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            const r = await importSubtitleFile(f);
            setMessage(r.cues ? t('subtitles.imported', r) : t('subtitles.importFailed'));
          }}
        />
        {track && (
          <>
            <Button className="text-xs" onClick={() => exportSubtitleFile(project, track, 'srt')} data-testid="export-srt">
              {t('subtitles.exportSrt')}
            </Button>
            <Button className="text-xs" onClick={() => exportSubtitleFile(project, track, 'vtt')}>
              {t('subtitles.exportVtt')}
            </Button>
            <Button className="text-xs" onClick={() => setMessage(t('subtitles.fixed', { count: fixTiming(track.id) }))}>
              {t('subtitles.fixTiming')}
            </Button>
            <Button
              className="text-xs text-red-300"
              onClick={() => window.confirm(t('subtitles.confirmRemove')) && removeSubtitleTrack(track.id)}
            >
              {t('subtitles.removeTrack')}
            </Button>
          </>
        )}
      </div>
      {message && (
        <div className="flex items-start gap-2 rounded bg-surface-2 p-2" role="status">
          <span className="flex-1">{message}</span>
          <button onClick={() => setMessage(null)} aria-label={t('media.dismiss')}>
            ✕
          </button>
        </div>
      )}

      <AutoSubtitles project={project} />

      {track ? <CueList track={track} /> : <p className="p-4 text-center text-neutral-400">{t('subtitles.empty')}</p>}
      <p className="mt-auto pt-2 text-[11px] text-neutral-400">{t('media.privacy')}</p>
    </div>
  );
}

function CueList({ track }: { track: SubtitleTrack }) {
  const { t } = useTranslation();
  const issues = useMemo(() => lintCues(track.cues), [track.cues]);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const selection = useTimelineUi((s) => s.selection);
  const time = useTransport((s) => s.time);
  const active = cueAt(track, time)?.id;
  const focusCueId = useSubtitlesUi((s) => s.focusCueId);
  // The issues filter never hides the cue being edited.
  const shown = onlyIssues
    ? track.cues.filter((c) => issues.has(c.id) || selection.includes(c.id) || c.id === focusCueId)
    : track.cues;

  // Keep the selected cue in view when it is selected on the timeline.
  const listRef = useRef<HTMLOListElement>(null);
  const firstSelected = selection.find((id) => track.cues.some((c) => c.id === id));
  useEffect(() => {
    if (firstSelected) listRef.current?.querySelector(`[data-cue-row="${firstSelected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [firstSelected]);

  // Focus the text of a cue double-clicked on the timeline.
  useEffect(() => {
    if (!focusCueId) return;
    const box = listRef.current?.querySelector<HTMLTextAreaElement>(`[data-cue-row="${focusCueId}"] textarea`);
    if (!box) return;
    box.scrollIntoView({ block: 'nearest' });
    box.focus();
    box.select();
    useSubtitlesUi.setState({ focusCueId: null });
  }, [focusCueId]);

  return (
    <>
      <div className="flex items-center gap-2 text-neutral-400">
        <span>{t('subtitles.summary', { count: track.cues.length, issues: issues.size })}</span>
        <label className="ms-auto flex items-center gap-1">
          <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
          {t('subtitles.onlyIssues')}
        </label>
      </div>
      <Button
        className="text-xs"
        data-testid="add-cue"
        onClick={() => {
          let id: string | null = null;
          edit('ops.addCue', (p) => {
            const st = p.subtitleTracks.find((x) => x.id === track.id);
            if (st) id = addCue(st, useTransport.getState().time);
          });
          if (id) select([id]);
        }}
      >
        + {t('subtitles.addCue')}
      </Button>
      <ol ref={listRef} className="space-y-1" data-testid="cue-list">
        {shown.map((cue) => (
          <CueRow
            key={cue.id}
            cue={cue}
            index={track.cues.indexOf(cue)}
            rtl={track.rtl}
            issues={issues.get(cue.id)}
            active={cue.id === active}
            selected={selection.includes(cue.id)}
            isLast={cue === track.cues.at(-1)}
          />
        ))}
      </ol>
    </>
  );
}

const CueRow = memo(function CueRow(props: {
  cue: Cue;
  index: number;
  rtl: boolean;
  issues?: CueIssue[];
  active: boolean;
  selected: boolean;
  isLast: boolean;
}) {
  const { t } = useTranslation();
  const { cue } = props;
  const fps = useProjectStore((s) => s.history?.present.settings.fps ?? 30);
  const now = () => useTransport.getState().time;
  const seekHere = () => {
    useTransport.getState().pause();
    useTransport.getState().seek(cue.start + 1e-3);
    select([cue.id]);
  };
  const iconBtn = 'rounded px-1 text-neutral-400 hover:bg-surface-3 hover:text-white';

  return (
    <li
      data-cue-row={cue.id}
      data-testid="cue-row"
      className={`rounded border p-1.5 ${props.selected ? 'border-accent' : props.active ? 'border-fuchsia-500/70' : 'border-transparent'} ${
        props.issues ? 'bg-amber-950/40' : 'bg-surface-2'
      }`}
    >
      <div className="flex items-center gap-1 font-mono text-[10px] text-neutral-400" dir="ltr">
        <span className="w-6 text-neutral-400">{props.index + 1}</span>
        <button className="hover:text-white" onClick={seekHere} title={t('subtitles.seek')}>
          {formatTimecode(cue.start, fps)} → {formatTimecode(cue.end, fps)}
        </button>
        <span className="ms-auto flex gap-0.5">
          <button className={iconBtn} title={t('subtitles.startHere')} aria-label={t('subtitles.startHere')} onClick={() => edit('ops.cueTiming', (p) => void setCueEdge(p, cue.id, 'start', now()))}>
            ⇤
          </button>
          <button className={iconBtn} title={t('subtitles.endHere')} aria-label={t('subtitles.endHere')} onClick={() => edit('ops.cueTiming', (p) => void setCueEdge(p, cue.id, 'end', now()))}>
            ⇥
          </button>
          <button className={iconBtn} title={t('subtitles.split')} aria-label={t('subtitles.split')} onClick={() => edit('ops.splitCue', (p) => void splitCue(p, cue.id, now()))}>
            ✂
          </button>
          {!props.isLast && (
            <button className={iconBtn} title={t('subtitles.merge')} aria-label={t('subtitles.merge')} onClick={() => edit('ops.mergeCues', (p) => void mergeWithNext(p, cue.id))}>
              ⤓
            </button>
          )}
          <button
            className={`${iconBtn} hover:text-red-300`}
            title={t('subtitles.deleteCue')}
            aria-label={t('subtitles.deleteCue')}
            onClick={() =>
              edit('ops.deleteCue', (p) => {
                for (const st of p.subtitleTracks) st.cues = st.cues.filter((c) => c.id !== cue.id);
              })
            }
          >
            🗑
          </button>
        </span>
      </div>
      <textarea
        dir={props.rtl ? 'rtl' : 'ltr'}
        data-testid="cue-text"
        rows={Math.max(1, cue.text.split('\n').length)}
        className="mt-1 w-full resize-none rounded bg-surface-0 px-1.5 py-1 text-sm leading-6"
        value={cue.text}
        onFocus={() => select([cue.id])}
        onChange={(e) => edit('ops.cueText', (p) => setCueText(p, cue.id, e.target.value), { mergeKey: `${cue.id}:text` })}
      />
      {props.issues && (
        <div className="mt-1 flex flex-wrap gap-1">
          {props.issues.map((i) => (
            <span key={i} className="rounded bg-amber-900/70 px-1.5 text-[10px] text-amber-100" title={t(`subtitles.issues.${i}Hint`)}>
              {t(`subtitles.issues.${i}`)}
            </span>
          ))}
        </div>
      )}
    </li>
  );
});
