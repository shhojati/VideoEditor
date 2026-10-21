import { describe, expect, it } from 'vitest';
import { createProject } from './factories';
import { BUILTIN_TEMPLATES, insertTemplate, templateSchema } from './templates';
import { revealLines, textAnimState } from './textAnim';

describe('textAnimState', () => {
  it('is idle without animations and in the middle of a clip', () => {
    expect(textAnimState(undefined, 0, 4).alpha).toBe(1);
    expect(textAnimState({ in: 'fade', out: 'fade', duration: 0.5 }, 2, 4)).toMatchObject({ alpha: 1, dx: 0, scale: 1 });
  });

  it('animates in from the start and out towards the end', () => {
    const a = { in: 'slideUp' as const, out: 'zoom' as const, duration: 1 };
    const start = textAnimState(a, 0, 4);
    expect(start.alpha).toBe(0);
    expect(start.dy).toBeGreaterThan(0.1);
    const end = textAnimState(a, 3.9, 4);
    expect(end.scale).toBeGreaterThan(1.4);
    expect(end.alpha).toBeLessThan(0.3);
  });

  it('caps the animation at half the clip and reveals text gradually', () => {
    const s = textAnimState({ in: 'typewriter', duration: 5 }, 0.5, 2); // effectively 1 s long
    expect(s.chars).toBeCloseTo(0.5);
    expect(revealLines(['hello', 'world'], 0.5, 1)).toEqual(['hello', '']);
    expect(revealLines(['one two', 'three four'], 1, 0.5)).toEqual(['one two', '']);
    expect(revealLines(['سلام 👋'], 0.9, 1)).toEqual(['سلام ']);
  });
});

describe('templates', () => {
  it('every built-in passes the server schema, with unique ids', () => {
    for (const tpl of BUILTIN_TEMPLATES) expect(templateSchema.safeParse(tpl).success, tpl.id).toBe(true);
    expect(new Set(BUILTIN_TEMPLATES.map((x) => x.id)).size).toBe(BUILTIN_TEMPLATES.length);
  });

  it('insert on new tracks on top, at the playhead, without overlaps', () => {
    for (const tpl of BUILTIN_TEMPLATES) {
      const p = createProject('t');
      const before = p.tracks.length;
      const ids = insertTemplate(p, tpl, 10, false);
      expect(ids).toHaveLength(tpl.clips.length);
      const added = p.tracks.slice(before);
      expect(added.every((t) => t.kind === 'text')).toBe(true);
      for (const t of added)
        t.clips.forEach((c, i) => {
          expect(c.start).toBeGreaterThanOrEqual(10);
          if (i) expect(c.start).toBeGreaterThanOrEqual(t.clips[i - 1].start + t.clips[i - 1].duration - 1e-9);
        });
    }
  });

  it('uses the Persian placeholder text in Persian', () => {
    const p = createProject('t');
    insertTemplate(p, BUILTIN_TEMPLATES.find((x) => x.id === 'outro-thanks')!, 0, true);
    const texts = p.tracks.flatMap((t) => t.clips).map((c) => c.text);
    expect(texts[0]).toMatchObject({ content: 'ممنون که تماشا کردید!', rtl: true });
  });
});
