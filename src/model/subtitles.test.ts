import { describe, expect, it } from 'vitest';
import { createProject, createSubtitleTrack } from './factories';
import {
  addCue,
  autoFixTiming,
  canShiftCues,
  convertDigits,
  cueEdgeLimits,
  findCue,
  lintCues,
  mergeWithNext,
  setCueEdge,
  setCueText,
  shiftCues,
  splitCue,
} from './subtitles';
import type { Cue } from './types';

const cue = (id: string, start: number, end: number, text = 'متن'): Cue => ({ id, start, end, text });

function setup(cues: Cue[] = [cue('a', 1, 3, 'سلام دنیا خوش آمدید'), cue('b', 4, 6, 'دوم')]) {
  const p = createProject('t');
  const track = createSubtitleTrack('fa');
  track.cues = cues;
  p.subtitleTracks.push(track);
  return { p, track };
}

describe('editing', () => {
  it('adds a cue in free space, after a cue it lands inside, shortened before the next', () => {
    const { track } = setup();
    const byId = (id: string | null) => track.cues.find((c) => c.id === id);
    expect(byId(addCue(track, 10))).toMatchObject({ start: 10, end: 12 });
    expect(byId(addCue(track, 2))).toMatchObject({ start: 3, end: 4 });
    expect(addCue(track, 3.95)).toBeNull(); // only 0.05 s of room
    expect(track.cues.map((c) => c.start)).toEqual([1, 3, 4, 10]);
  });

  it('splits words in proportion to time', () => {
    const { p } = setup();
    const id = splitCue(p, 'a', 1.7)!;
    expect(findCue(p, 'a')!.cue).toMatchObject({ end: 1.7, text: 'سلام' });
    expect(findCue(p, id)!.cue).toMatchObject({ start: 1.7, end: 3, text: 'دنیا خوش آمدید' });
  });

  it('merges with the next cue', () => {
    const { p, track } = setup();
    expect(mergeWithNext(p, 'a')).toBe(true);
    expect(track.cues).toEqual([cue('a', 1, 6, 'سلام دنیا خوش آمدید دوم')]);
    expect(mergeWithNext(p, 'a')).toBe(false);
  });

  it('clamps edges between neighbours', () => {
    const { p, track } = setup();
    expect(cueEdgeLimits(track, 1, 'start')).toEqual({ min: 3, max: 5.8 });
    expect(setCueEdge(p, 'b', 'start', 0)).toBe(3);
    expect(setCueEdge(p, 'a', 'end', 99)).toBe(3); // b now starts at 3
  });

  it('shifts cues unless they would collide', () => {
    const { p, track } = setup();
    expect(canShiftCues(track, new Set(['a']), 1.5)).toBe(false);
    expect(shiftCues(p, new Set(['a', 'b']), 10)).toBe(true);
    expect(track.cues.map((c) => c.start)).toEqual([11, 14]);
    expect(shiftCues(p, new Set(['a']), -20)).toBe(false);
  });

  it('editing text clears the review flag', () => {
    const { p } = setup([{ ...cue('a', 1, 2), flag: 'review' }]);
    setCueText(p, 'a', 'درست شد');
    expect(findCue(p, 'a')!.cue).toEqual(cue('a', 1, 2, 'درست شد'));
  });
});

describe('lintCues', () => {
  it('flags each rule', () => {
    const issues = lintCues([
      cue('short', 0, 0.5, 'کوتاه'),
      cue('overlap', 0.4, 9, 'طولانی'),
      cue('gap', 9.03, 11, 'خط ۱\nخط ۲\nخط ۳'),
      cue('fast', 11.1, 12.1, 'این جمله برای یک ثانیه خیلی خیلی طولانی است'),
      cue('wide', 20, 26, 'a'.repeat(43) + '\nb'),
      cue('empty', 30, 32, '  '),
    ]);
    expect(issues.get('short')).toContain('short');
    expect(issues.get('short')).toContain('overlap');
    expect(issues.get('overlap')).toEqual(expect.arrayContaining(['long', 'gap']));
    expect(issues.get('gap')).toEqual(['lines']);
    expect(issues.get('fast')).toEqual(['cps']);
    expect(issues.get('wide')).toEqual(['lineLength']);
    expect(issues.get('empty')).toEqual(['empty']);
  });

  it('accepts a good cue and a single long line that wraps into two', () => {
    expect(lintCues([cue('ok', 0, 4, 'x'.repeat(60))]).size).toBe(0);
  });
});

describe('autoFixTiming', () => {
  it('resolves overlaps, keeps the gap, caps long and extends short cues', () => {
    const { track } = setup([cue('a', 0, 0.5), cue('b', 0.4, 9), cue('c', 12, 12.5)]);
    autoFixTiming(track);
    const [a, b, c] = track.cues;
    expect(a.end).toBeCloseTo(0.32); // short, but pushed back by b (starts 0.4) minus the gap
    expect(b.start).toBeCloseTo(0.4);
    expect(b.end - b.start).toBeCloseTo(7);
    expect(c.end).toBeCloseTo(13); // extended to 1 s
    expect(lintCues(track.cues).get('b')).toBeUndefined();
  });
});

it('converts digits both ways', () => {
  expect(convertDigits('ساعت 10:30 و ٤', 'persian')).toBe('ساعت ۱۰:۳۰ و ۴');
  expect(convertDigits('۱۴۰۳ و ٢', 'latin')).toBe('1403 و 2');
  expect(convertDigits('123', 'keep')).toBe('123');
});
