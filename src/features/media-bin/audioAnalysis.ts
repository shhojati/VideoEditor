// On-demand audio analysis for cleanup: an asset's noise profile (cached in memory and IndexedDB)
// and a clip's loudness for Normalize. Both run in the media worker.
import { hasCleanStage, type NoiseProfile } from '../../engine/audio/cleanDsp';
import type { Clip, ID, Project } from '../../model/types';
import { getDerived, putDerived } from '../../store/persistence';
import { mediaWorker } from './mediaService';
import { sourceLength } from '../../model/remap';

const profiles = new Map<ID, NoiseProfile>();
const pending = new Map<ID, Promise<NoiseProfile | undefined>>();

/** The profile if it is ready (starts making it otherwise, for the next playback). */
export function noiseProfileOf(project: Project, assetId: ID): NoiseProfile | undefined {
  const ready = profiles.get(assetId);
  if (!ready) void ensureNoiseProfile(project, assetId);
  return ready;
}

export function ensureNoiseProfile(project: Project, assetId: ID): Promise<NoiseProfile | undefined> {
  const ready = profiles.get(assetId);
  if (ready) return Promise.resolve(ready);
  const asset = project.assets[assetId];
  const opfsPath = asset?.fileRef.opfsPath;
  if (!opfsPath) return Promise.resolve(undefined);
  let job = pending.get(assetId);
  if (!job) {
    job = (async () => {
      try {
        const cached = await getDerived(assetId);
        let profile = cached?.noise;
        if (!profile) {
          profile = (await mediaWorker().noiseProfile({ opfsPath })).profile;
          await putDerived({ ...(cached ?? { assetId }), noise: profile });
        }
        profiles.set(assetId, profile);
        return profile;
      } catch (e) {
        console.warn('noise profile failed', asset.name, e);
        return undefined;
      } finally {
        pending.delete(assetId);
      }
    })();
    pending.set(assetId, job);
  }
  return job;
}

function cleanedAssets(project: Project): Set<ID> {
  const ids = new Set<ID>();
  for (const track of project.tracks)
    for (const clip of track.clips) if (clip.assetId && hasCleanStage(clip)) ids.add(clip.assetId);
  return ids;
}

/** Ready noise profiles of the assets whose clips use cleanup (missing ones start being made). */
export function readyNoiseProfiles(project: Project): Record<ID, NoiseProfile> {
  const out: Record<ID, NoiseProfile> = {};
  for (const id of cleanedAssets(project)) {
    const p = noiseProfileOf(project, id);
    if (p) out[id] = p;
  }
  return out;
}

/** Like readyNoiseProfiles, but waits for missing ones (export). */
export async function allNoiseProfiles(project: Project): Promise<Record<ID, NoiseProfile>> {
  const out: Record<ID, NoiseProfile> = {};
  for (const id of cleanedAssets(project)) {
    const p = await ensureNoiseProfile(project, id);
    if (p) out[id] = p;
  }
  return out;
}

/** Integrated loudness (LUFS) of the part of the source a clip plays. */
export async function clipLoudness(project: Project, clip: Clip): Promise<number> {
  const opfsPath = clip.assetId ? project.assets[clip.assetId]?.fileRef.opfsPath : undefined;
  if (!opfsPath) return -Infinity;
  const { lufs } = await mediaWorker().loudness({ opfsPath, from: clip.inPoint, to: clip.inPoint + sourceLength(clip) });
  return lufs;
}
