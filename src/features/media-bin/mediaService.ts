// Main-thread coordination for media: importing files, detecting missing files, relinking,
// and loading/generating thumbnails + waveforms (generated in media.worker, cached in IndexedDB).
// Everything here is UI state; the project document only gains/loses Asset entries via edit().
import { create } from 'zustand';
import { looksLikeMedia, type ProbeErrorCode } from '../../engine/decode/classify';
import { ProbeError, probeFile } from '../../engine/decode/probe';
import { newId } from '../../model/factories';
import { deleteClipsOfAsset } from '../../model/timeline';
import type { Asset, ID, Project } from '../../model/types';
import { getMediaFile, hasRoomFor, mediaPathFor, requestPersistentStorage, writeMediaFile } from '../../lib/opfs';
import { getDerived, putDerived, type DerivedMedia } from '../../store/persistence';
import { useProjectStore } from '../../store/projectStore';
import { rpcClient } from '../../workers/rpc';
import type { MediaWorkerApi } from '../../workers/media.worker';

export const THUMB_HEIGHT = 90;
export const PEAKS_PER_SECOND = 100;

export interface ImportJob {
  id: string;
  name: string;
  stage: 'probing' | 'copying' | 'error';
  progress: number;
  error?: { code: ProbeErrorCode | 'copy'; codec?: string };
}

export interface AssetMediaState {
  status: 'checking' | 'ready' | 'processing' | 'missing';
  thumbs?: { times: number[]; urls: string[]; width: number; height: number };
  waveform?: { peaksPerSecond: number; peaks: Float32Array };
}

interface MediaState {
  imports: ImportJob[];
  assets: Record<ID, AssetMediaState>;
}

export const useMedia = create<MediaState>()(() => ({ imports: [], assets: {} }));

const setAsset = (id: ID, patch: Partial<AssetMediaState>) =>
  useMedia.setState((s) => ({
    assets: { ...s.assets, [id]: { ...(s.assets[id] ?? { status: 'checking' }), ...patch } },
  }));

const setJob = (id: string, patch: Partial<ImportJob>) =>
  useMedia.setState((s) => ({ imports: s.imports.map((j) => (j.id === id ? { ...j, ...patch } : j)) }));

export function dismissImport(id: string) {
  useMedia.setState((s) => ({ imports: s.imports.filter((j) => j.id !== id) }));
}

// ---- worker -------------------------------------------------------------------------------------

let worker: ReturnType<typeof rpcClient<MediaWorkerApi>> | null = null;
const mediaWorker = () =>
  (worker ??= rpcClient<MediaWorkerApi>(
    new Worker(new URL('../../workers/media.worker.ts', import.meta.url), { type: 'module' }),
  ));

/** One asset at a time keeps decoder memory and disk I/O bounded. */
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

const thumbCount = (duration = 0) => Math.min(40, Math.max(4, Math.ceil(duration / 3)));

async function generateDerived(asset: Asset): Promise<DerivedMedia> {
  const opfsPath = asset.fileRef.opfsPath!;
  const derived: DerivedMedia = { assetId: asset.id };
  if (asset.kind === 'video' || asset.kind === 'image') {
    derived.thumbs = await mediaWorker().thumbnails({
      opfsPath,
      kind: asset.kind,
      duration: asset.duration,
      count: asset.kind === 'image' ? 1 : thumbCount(asset.duration),
      height: THUMB_HEIGHT,
    });
  }
  if (asset.kind === 'audio' || (asset.kind === 'video' && asset.hasAudio)) {
    derived.waveform = {
      peaksPerSecond: PEAKS_PER_SECOND,
      ...(await mediaWorker().waveform({ opfsPath, duration: asset.duration ?? 0, peaksPerSecond: PEAKS_PER_SECOND })),
    };
  }
  await putDerived(derived);
  return derived;
}

function showDerived(id: ID, d: DerivedMedia) {
  const old = useMedia.getState().assets[id]?.thumbs;
  old?.urls.forEach((u) => URL.revokeObjectURL(u));
  setAsset(id, {
    status: 'ready',
    thumbs: d.thumbs && {
      times: d.thumbs.times,
      urls: d.thumbs.blobs.map((b) => URL.createObjectURL(b)),
      width: d.thumbs.width,
      height: d.thumbs.height,
    },
    waveform: d.waveform,
  });
}

/** Check the file is still there, then show cached thumbnails/waveform or generate them. */
async function checkAsset(asset: Asset, regenerate = false) {
  const path = asset.fileRef.opfsPath;
  if (!path || !(await getMediaFile(path))) {
    setAsset(asset.id, { status: 'missing' });
    return;
  }
  const cached = regenerate ? undefined : await getDerived(asset.id);
  if (cached) return showDerived(asset.id, cached);
  setAsset(asset.id, { status: 'processing' });
  try {
    showDerived(asset.id, await enqueue(() => generateDerived(asset)));
  } catch (e) {
    console.warn('thumbnail/waveform generation failed', asset.name, e);
    setAsset(asset.id, { status: 'ready' }); // usable without previews
  }
}

// ---- watcher ------------------------------------------------------------------------------------

/**
 * Keep media state in step with the open project: reset on project switch, and check any asset
 * that appears (import, undo of a delete, project open).
 */
export function startMediaWatcher(): () => void {
  const checked = new Set<ID>();
  const sync = (project: Project | undefined, prevId: ID | undefined) => {
    if (project?.id !== prevId) {
      for (const a of Object.values(useMedia.getState().assets)) a.thumbs?.urls.forEach((u) => URL.revokeObjectURL(u));
      useMedia.setState({ assets: {} });
      checked.clear();
    }
    if (!project) return;
    for (const asset of Object.values(project.assets)) {
      if (checked.has(asset.id)) continue;
      checked.add(asset.id);
      void checkAsset(asset);
    }
  };
  sync(useProjectStore.getState().history?.present, undefined);
  return useProjectStore.subscribe((s, prev) => {
    if (s.history?.present !== prev.history?.present) sync(s.history?.present, prev.history?.present.id);
  });
}

// ---- import -------------------------------------------------------------------------------------

export async function importFiles(files: File[]) {
  const media = files.filter(looksLikeMedia);
  if (media.length === 0) return;
  void requestPersistentStorage();
  const jobs = media.map((f) => ({ id: newId(), name: f.name, stage: 'probing' as const, progress: 0 }));
  useMedia.setState((s) => ({ imports: [...s.imports, ...jobs] }));
  // Sequential: probing is cheap, but copying several large files at once only thrashes the disk.
  for (const [i, file] of media.entries()) await importOne(file, jobs[i].id);
}

async function importOne(file: File, jobId: string) {
  try {
    const probed = await probeFile(file);
    if (!(await hasRoomFor(file.size))) throw new ProbeError('quota');
    const id = newId();
    const opfsPath = mediaPathFor(id);
    setJob(jobId, { stage: 'copying' });
    try {
      await writeMediaFile(opfsPath, file, (progress) => setJob(jobId, { progress }));
    } catch {
      setJob(jobId, { stage: 'error', error: { code: 'copy' } });
      return;
    }
    const { warnings: _warnings, ...meta } = probed;
    useProjectStore.getState().edit('ops.importMedia', (p) => {
      p.assets[id] = { id, ...meta, fileRef: { opfsPath } };
    });
    dismissImport(jobId);
  } catch (e) {
    const err = e instanceof ProbeError ? { code: e.code, codec: e.codec } : { code: 'unsupportedFormat' as const };
    setJob(jobId, { stage: 'error', error: err });
  }
}

// ---- relink / remove ----------------------------------------------------------------------------

export type RelinkResult = 'ok' | 'kindMismatch' | 'durationMismatch' | ProbeErrorCode | 'copy';

/**
 * Replace a missing file. The new file must be the same kind; a duration that differs by more than
 * a second needs `force` (the caller confirms with the user first).
 */
export async function relinkAsset(asset: Asset, file: File, force = false): Promise<RelinkResult> {
  let probed;
  try {
    probed = await probeFile(file);
  } catch (e) {
    return e instanceof ProbeError ? e.code : 'unsupportedFormat';
  }
  if (probed.kind !== asset.kind) return 'kindMismatch';
  if (!force && asset.duration !== undefined && Math.abs((probed.duration ?? 0) - asset.duration) > 1) {
    return 'durationMismatch';
  }
  const opfsPath = asset.fileRef.opfsPath ?? mediaPathFor(asset.id);
  setAsset(asset.id, { status: 'processing' });
  try {
    await writeMediaFile(opfsPath, file);
  } catch {
    setAsset(asset.id, { status: 'missing' });
    return 'copy';
  }
  const { warnings: _warnings, ...meta } = probed;
  useProjectStore.getState().edit('ops.relinkMedia', (p) => {
    p.assets[asset.id] = { ...p.assets[asset.id], ...meta, name: asset.name, fileRef: { opfsPath } };
  });
  await checkAsset({ ...asset, ...meta, fileRef: { opfsPath } }, true);
  return 'ok';
}

/**
 * Removes the asset and every clip that uses it, as one undo step. The stored file is kept until
 * the next startup's cleanup so undo still works.
 */
export function removeAsset(id: ID) {
  useProjectStore.getState().edit('ops.removeMedia', (p) => {
    deleteClipsOfAsset(p, id);
    delete p.assets[id];
  });
}
