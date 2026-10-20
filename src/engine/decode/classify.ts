import type { AssetKind } from '../../model/types';

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
const MEDIA_EXT = /\.(mp4|m4v|mov|webm|mkv|mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i;

export const ACCEPT_ATTR = 'video/*,audio/*,image/*,.mkv,.mov,.m4a,.flac,.opus';

export function looksLikeImage(file: { name: string; type: string }) {
  return file.type.startsWith('image/') || IMAGE_EXT.test(file.name);
}

export function looksLikeMedia(file: { name: string; type: string }) {
  return (
    looksLikeImage(file) || file.type.startsWith('video/') || file.type.startsWith('audio/') || MEDIA_EXT.test(file.name)
  );
}

interface TrackInfo {
  codec: string | null;
  decodable: boolean;
}

/** i18n keys under `media.errors.*` / `media.warnings.*`. */
export type ProbeErrorCode = 'unsupportedFormat' | 'noTracks' | 'videoCodec' | 'audioCodec' | 'image' | 'quota';
export type ProbeWarningCode = 'audioCodec';

export type Classification =
  | { ok: true; kind: AssetKind; hasAudio: boolean; warnings: ProbeWarningCode[] }
  | { ok: false; error: ProbeErrorCode; codec?: string };

/**
 * Decide what a container's tracks mean for the editor.
 * A video we cannot decode is rejected; an undecodable audio track beside a good video is only a warning.
 */
export function classifyTracks(video?: TrackInfo, audio?: TrackInfo): Classification {
  if (!video && !audio) return { ok: false, error: 'noTracks' };
  if (video) {
    if (!video.decodable) return { ok: false, error: 'videoCodec', codec: video.codec ?? undefined };
    const audioOk = !!audio?.decodable;
    return { ok: true, kind: 'video', hasAudio: audioOk, warnings: audio && !audioOk ? ['audioCodec'] : [] };
  }
  if (!audio!.decodable) return { ok: false, error: 'audioCodec', codec: audio!.codec ?? undefined };
  return { ok: true, kind: 'audio', hasAudio: true, warnings: [] };
}
