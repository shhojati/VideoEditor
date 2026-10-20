import { describe, expect, it } from 'vitest';
import { createProject, createSubtitleTrack } from './factories';
import { InvalidProjectError, parseProject } from './validate';

describe('parseProject', () => {
  it('accepts a freshly created project and survives a JSON round trip', () => {
    const p = createProject('Test', '9:16');
    p.subtitleTracks.push(createSubtitleTrack('fa'));
    p.subtitleTracks[0].cues.push({ id: 'c1', start: 1, end: 2.5, text: 'سلام دنیا' });
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('reports the path of the first invalid field', () => {
    const p = createProject('Test');
    const bad = { ...p, settings: { ...p.settings, width: -1 } };
    expect(() => parseProject(bad)).toThrow(InvalidProjectError);
    expect(() => parseProject(bad)).toThrow(/settings\.width/);
  });

  it('rejects cues that end before they start', () => {
    const p = createProject('Test');
    const st = createSubtitleTrack('fa');
    st.cues.push({ id: 'c', start: 3, end: 2, text: 'x' });
    p.subtitleTracks.push(st);
    expect(() => parseProject(p)).toThrow(/end must be after start/);
  });
});

describe('factories', () => {
  it('defaults to 16:9 1080p30 with an audio track under a video track', () => {
    const p = createProject('x');
    expect(p.settings).toEqual({ width: 1920, height: 1080, fps: 30, sampleRate: 48000 });
    expect(p.tracks.map((t) => t.kind)).toEqual(['audio', 'video']);
  });

  it('marks Persian/Arabic subtitle tracks as RTL', () => {
    expect(createSubtitleTrack('fa').rtl).toBe(true);
    expect(createSubtitleTrack('en').rtl).toBe(false);
  });
});
