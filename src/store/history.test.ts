import { describe, expect, it } from 'vitest';
import { createHistory, edit, HISTORY_LIMIT, redo, undo } from './history';

type Doc = { name: string; n: number; items: string[] };
const start = (): Doc => ({ name: 'a', n: 0, items: [] });

describe('history', () => {
  it('undoes and redoes edits in order', () => {
    let h = createHistory(start());
    h = edit(h, 'rename', (d) => void (d.name = 'b'));
    h = edit(h, 'push', (d) => void d.items.push('x'));
    expect(h.present).toEqual({ name: 'b', n: 0, items: ['x'] });

    h = undo(h);
    expect(h.present).toEqual({ name: 'b', n: 0, items: [] });
    h = undo(h);
    expect(h.present).toEqual(start());
    h = undo(h); // nothing left: no-op
    expect(h.present).toEqual(start());

    h = redo(h);
    h = redo(h);
    expect(h.present).toEqual({ name: 'b', n: 0, items: ['x'] });
    expect(h.future).toHaveLength(0);
  });

  it('clears the redo stack on a new edit', () => {
    let h = createHistory(start());
    h = edit(h, 'a', (d) => void (d.n = 1));
    h = undo(h);
    h = edit(h, 'b', (d) => void (d.n = 2));
    expect(h.future).toHaveLength(0);
    expect(redo(h)).toBe(h);
  });

  it('ignores values returned from the recipe', () => {
    const h = edit(createHistory(start()), 'assign', (d) => Object.assign(d, { n: 7 }));
    expect(h.present.n).toBe(7);
    expect(undo(h).present.n).toBe(0);
  });

  it('does not record no-op edits', () => {
    const h = createHistory(start());
    expect(edit(h, 'noop', (d) => void (d.name = 'a'))).toBe(h);
  });

  it('merges consecutive edits with the same mergeKey inside the window', () => {
    let h = createHistory(start());
    h = edit(h, 'drag', (d) => void (d.n = 1), { mergeKey: 'slider', now: 0 });
    h = edit(h, 'drag', (d) => void (d.n = 2), { mergeKey: 'slider', now: 300 });
    h = edit(h, 'drag', (d) => void (d.n = 3), { mergeKey: 'slider', now: 600 });
    expect(h.past).toHaveLength(1);
    expect(undo(h).present.n).toBe(0);

    h = edit(h, 'drag', (d) => void (d.n = 4), { mergeKey: 'slider', now: 5000 });
    expect(h.past).toHaveLength(2);
    expect(undo(h).present.n).toBe(3);
  });

  it('keeps structural sharing for untouched branches', () => {
    let h = createHistory(start());
    const items = h.present.items;
    h = edit(h, 'n', (d) => void (d.n = 5));
    expect(h.present.items).toBe(items);
  });

  it('caps the undo stack', () => {
    let h = createHistory(start());
    for (let i = 1; i <= HISTORY_LIMIT + 10; i++) h = edit(h, 'n', (d) => void (d.n = i));
    expect(h.past).toHaveLength(HISTORY_LIMIT);
  });
});
