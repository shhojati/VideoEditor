import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import type { Asset } from '../../model/types';
import { classifyTracks, looksLikeImage, type ProbeErrorCode, type ProbeWarningCode } from './classify';

export class ProbeError extends Error {
  constructor(
    readonly code: ProbeErrorCode,
    readonly codec?: string,
  ) {
    super(`${code}${codec ? ` (${codec})` : ''}`);
  }
}

export type ProbedAsset = Omit<Asset, 'id' | 'fileRef'> & { warnings: ProbeWarningCode[] };

/**
 * Read only what is needed to describe a file (container headers, track info). Media files are read
 * lazily through BlobSource, so this never loads the whole file into memory.
 */
export async function probeFile(file: File): Promise<ProbedAsset> {
  const base = { name: file.name, size: file.size, mimeType: file.type || undefined };

  if (looksLikeImage(file)) {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new ProbeError('image');
    }
    const { width, height } = bitmap;
    bitmap.close();
    return { ...base, kind: 'image', width, height, warnings: [] };
  }

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    if (!(await input.canRead())) throw new ProbeError('unsupportedFormat');
    const [video, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    const [videoOk, audioOk] = await Promise.all([video?.canDecode() ?? false, audio?.canDecode() ?? false]);
    const result = classifyTracks(
      video ? { codec: video.codec, decodable: videoOk } : undefined,
      audio ? { codec: audio.codec, decodable: audioOk } : undefined,
    );
    if (!result.ok) throw new ProbeError(result.error, result.codec);

    const duration = await input.computeDuration();
    const codecs = { video: video?.codec ?? undefined, audio: audio?.codec ?? undefined };
    if (result.kind === 'audio') {
      return { ...base, kind: 'audio', duration, hasAudio: true, codecs, warnings: result.warnings };
    }
    const stats = await video!.computePacketStats(100);
    return {
      ...base,
      kind: 'video',
      duration,
      width: video!.displayWidth,
      height: video!.displayHeight,
      fps: stats.averagePacketRate > 0 ? Math.round(stats.averagePacketRate * 100) / 100 : undefined,
      hasAudio: result.hasAudio,
      codecs,
      warnings: result.warnings,
    };
  } catch (e) {
    if (e instanceof ProbeError) throw e;
    throw new ProbeError('unsupportedFormat');
  } finally {
    input.dispose();
  }
}
