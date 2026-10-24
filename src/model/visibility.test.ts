import { describe, expect, it } from 'vitest';
import { drawPlanAt } from '../engine/render/renderFrame';
import { audibleClips } from '../engine/export/audioMix';
import { createProject, createTrack } from './factories';
import { createClip } from './timeline';
import type { Asset } from './types';
import { soloActive, trackShows, trackSounds } from './visibility';

const song: Asset = { id: 's', kind: 'audio', name: 's.mp3', duration: 10, fileRef: { opfsPath: 's' } };
const film: Asset = { id: 'f', kind: 'video', name: 'f.mp4', duration: 10, hasAudio: true, fileRef: { opfsPath: 'f' } };
const photo: Asset = { id: 'p', kind: 'image', name: 'p.jpg', fileRef: { opfsPath: 'p' } };

function setup() {
  const p = createProject('t');
  p.assets = { s: song, f: film, p: photo };
  p.tracks = [createTrack('audio'), createTrack('video'), createTrack('video')];
  p.tracks[0].clips = [{ ...createClip(song, 0), id: 'song' }];
  p.tracks[1].clips = [{ ...createClip(film, 0), id: 'film' }];
  p.tracks[2].clips = [{ ...createClip(photo, 0), id: 'photo' }];
  return p;
}
const drawn = (p: ReturnType<typeof setup>) => drawPlanAt(p, 1).map((d) => (d.kind === 'clip' ? d.clip.id : ''));
const heard = (p: ReturnType<typeof setup>) => audibleClips(p).map((x) => x.clip.id);

describe('track eye and solo', () => {
  it('draws and plays everything by default', () => {
    const p = setup();
    expect(soloActive(p)).toBe(false);
    expect(drawn(p)).toEqual(['film', 'photo']);
    expect(heard(p)).toEqual(['song', 'film']);
  });

  it('a hidden track is not drawn but still heard', () => {
    const p = setup();
    p.tracks[1].hidden = true;
    expect(trackShows(p, p.tracks[1])).toBe(false);
    expect(drawn(p)).toEqual(['photo']);
    expect(heard(p)).toEqual(['song', 'film']);
  });

  it('while a track is soloed only soloed tracks are drawn and heard', () => {
    const p = setup();
    p.tracks[1].solo = true;
    expect(drawn(p)).toEqual(['film']);
    expect(heard(p)).toEqual(['film']);
    p.tracks[0].solo = true;
    expect(heard(p)).toEqual(['song', 'film']);
    // Mute and the eye still win over solo.
    p.tracks[0].muted = true;
    expect(trackSounds(p, p.tracks[0])).toBe(false);
    p.tracks[1].hidden = true;
    expect(drawn(p)).toEqual([]);
  });
});
