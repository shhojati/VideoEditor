// Auto reframe: detect the main person through a video clip, turn that into a calm camera path
// (model/reframe.ts), store it as a tracker and link the clip to it in 'reframe' mode, which slides
// the picture (filling the frame) to keep the subject centred.
import { create } from 'zustand';
import { ASPECT_PRESETS, newId, type AspectPreset } from '../../model/factories';
import { cameraPath, type Detection } from '../../model/reframe';
import { sourceLength } from '../../model/remap';
import { findClip } from '../../model/timeline';
import type { ID } from '../../model/types';
import { currentProject, useProjectStore } from '../../store/projectStore';
import type { DetectMessage, DetectRequest } from '../../workers/detect.worker';
import { requireAi } from '../account/aiGate';

const MODEL_FILE = '/models/Xenova/yolos-tiny/onnx/model_quantized.onnx';
/** Frames analysed per second of source, and at most this many per clip (~0.4 s each on WASM). */
const FPS = 4;
const MAX_FRAMES = 120;

interface ReframeState {
  /** Clip being analysed, and how far (0..1). */
  clipId: ID | null;
  progress: number;
  /** Clips still waiting (whole project). */
  queue: ID[];
  error?: 'missingModel' | 'failed';
}

export const useReframe = create<ReframeState>()(() => ({ clipId: null, progress: 0, queue: [] }));

let worker: Worker | null = null;
const project = () => currentProject() ?? undefined;

async function modelInstalled() {
  const r = await fetch(MODEL_FILE, { method: 'HEAD' }).catch(() => null);
  return !!r?.ok && !(r.headers.get('content-type') ?? '').includes('text/html');
}

export function cancelReframe() {
  worker?.terminate();
  worker = null;
  useReframe.setState({ clipId: null, progress: 0, queue: [] });
}

/** Analyse one clip and link it. Resolves when done (or failed). */
function analyse(clipId: ID): Promise<boolean> {
  const p = project();
  const clip = p && findClip(p, clipId)?.clip;
  const asset = clip?.assetId ? p!.assets[clip.assetId] : undefined;
  if (!clip || asset?.kind !== 'video' || !asset.fileRef.opfsPath) return Promise.resolve(false);
  const from = clip.inPoint;
  const to = clip.inPoint + sourceLength(clip);
  return new Promise((resolve) => {
    const detections: Detection[] = [];
    const w = new Worker(new URL('../../workers/detect.worker.ts', import.meta.url), { type: 'module' });
    worker = w;
    useReframe.setState({ clipId, progress: 0, error: undefined });
    w.onmessage = ({ data }: MessageEvent<DetectMessage>) => {
      if (worker !== w) return;
      if (data.type === 'progress') {
        detections.push(...data.detections);
        useReframe.setState({ progress: data.done });
      } else if (data.type === 'done' || data.type === 'error') {
        w.terminate();
        worker = null;
        if (data.type === 'error') {
          console.warn('reframe failed', data.message);
          useReframe.setState({ clipId: null, error: 'failed' });
          resolve(false);
          return;
        }
        link(clipId, detections);
        useReframe.setState({ clipId: null, progress: 1 });
        resolve(true);
      }
    };
    // WASM: the quantized detector runs faster there than on WebGPU.
    const fps = Math.max(1, Math.min(FPS, MAX_FRAMES / Math.max(0.1, to - from)));
    w.postMessage({ opfsPath: asset.fileRef.opfsPath!, from, to, fps, device: 'wasm' } satisfies DetectRequest);
  });
}

/** Store the camera path as a tracker and link the clip to it (replacing an earlier reframe). */
function link(clipId: ID, detections: Detection[]) {
  const samples = cameraPath(detections);
  if (!samples.length) return;
  useProjectStore.getState().edit('ops.reframe', (d) => {
    const clip = findClip(d, clipId)?.clip;
    if (!clip) return;
    const old = clip.motion?.mode === 'reframe' ? clip.motion.trackerId : undefined;
    clip.trackers = (clip.trackers ?? []).filter((t) => t.id !== old);
    const id = newId();
    clip.trackers.push({ id, name: 'Auto reframe', width: 0.25, height: 0.25, samples });
    clip.motion = { clipId, trackerId: id, mode: 'reframe', position: true, rotation: false, scale: false, ref: clip.inPoint };
    clip.transform.fit = 'cover';
  });
}

/** Auto reframe one clip (Pro). */
export async function autoReframe(clipId: ID) {
  if (!requireAi() || useReframe.getState().clipId) return;
  if (!(await modelInstalled())) {
    useReframe.setState({ error: 'missingModel' });
    return;
  }
  await analyse(clipId);
}

/** Switch the project to another aspect (default 9:16) and reframe every video clip (Pro). */
export async function reframeProject(aspect: AspectPreset = '9:16') {
  if (!requireAi() || useReframe.getState().clipId) return;
  if (!(await modelInstalled())) {
    useReframe.setState({ error: 'missingModel' });
    return;
  }
  const p = project();
  if (!p) return;
  useProjectStore.getState().edit('ops.aspect', (d) => void Object.assign(d.settings, ASPECT_PRESETS[aspect]));
  const ids = p.tracks.filter((t) => t.kind === 'video' && !t.locked).flatMap((t) => t.clips.filter((c) => c.assetId && p.assets[c.assetId]?.kind === 'video').map((c) => c.id));
  useReframe.setState({ queue: ids });
  for (const id of ids) {
    if (!useReframe.getState().queue.length) break; // cancelled
    useReframe.setState((s) => ({ queue: s.queue.filter((q) => q !== id) }));
    if (!(await analyse(id))) break;
  }
  useReframe.setState({ queue: [] });
}
