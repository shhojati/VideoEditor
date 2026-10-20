import { describe, expect, it } from 'vitest';
import { classifyTracks, looksLikeImage, looksLikeMedia } from './classify';

const ok = (codec: string) => ({ codec, decodable: true });
const bad = (codec: string) => ({ codec, decodable: false });

describe('classifyTracks', () => {
  it('video + audio', () => {
    expect(classifyTracks(ok('avc'), ok('aac'))).toEqual({ ok: true, kind: 'video', hasAudio: true, warnings: [] });
  });

  it('silent video', () => {
    expect(classifyTracks(ok('vp9'))).toEqual({ ok: true, kind: 'video', hasAudio: false, warnings: [] });
  });

  it('warns but keeps a video whose audio cannot be decoded', () => {
    expect(classifyTracks(ok('avc'), bad('ac3'))).toEqual({
      ok: true,
      kind: 'video',
      hasAudio: false,
      warnings: ['audioCodec'],
    });
  });

  it('rejects an undecodable video with its codec name', () => {
    expect(classifyTracks(bad('hevc'), ok('aac'))).toEqual({ ok: false, error: 'videoCodec', codec: 'hevc' });
  });

  it('audio-only files', () => {
    expect(classifyTracks(undefined, ok('mp3'))).toMatchObject({ ok: true, kind: 'audio' });
    expect(classifyTracks(undefined, bad('ac3'))).toEqual({ ok: false, error: 'audioCodec', codec: 'ac3' });
  });

  it('rejects files without tracks', () => {
    expect(classifyTracks()).toEqual({ ok: false, error: 'noTracks' });
  });
});

describe('file type sniffing', () => {
  it('recognises images by MIME or extension', () => {
    expect(looksLikeImage({ name: 'a.PNG', type: '' })).toBe(true);
    expect(looksLikeImage({ name: 'x', type: 'image/webp' })).toBe(true);
    expect(looksLikeImage({ name: 'a.mp4', type: 'video/mp4' })).toBe(false);
  });

  it('accepts media and ignores everything else', () => {
    expect(looksLikeMedia({ name: 'talk.mkv', type: '' })).toBe(true);
    expect(looksLikeMedia({ name: 'song.mp3', type: 'audio/mpeg' })).toBe(true);
    expect(looksLikeMedia({ name: 'notes.txt', type: 'text/plain' })).toBe(false);
  });
});
