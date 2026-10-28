import { readFileSync, writeFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../../model/factories';
import { findClip } from '../../model/timeline';
import type { Asset, Project } from '../../model/types';
import { rootProject, useProjectStore } from '../../store/projectStore';
import { agentToolList, runCommand } from './commands';

const video: Asset = { id: 'v1', kind: 'video', name: 'beach.mp4', duration: 10, width: 1920, height: 1080, hasAudio: true, fileRef: { opfsPath: 'media/v1' } };

beforeEach(() => {
  const p: Project = createProject('Test');
  p.assets[video.id] = video;
  useProjectStore.getState().load(p);
});

/** Run a tool and parse its JSON text answer. */
async function call(name: string, args: unknown = {}) {
  const r = await runCommand(name, args);
  const first = r.content[0];
  return { isError: !!r.isError, text: first.type === 'text' ? first.text : '', data: first.type === 'text' && !r.isError ? JSON.parse(first.text) : undefined };
}

const steps = () => useProjectStore.getState().history!.past.length;

describe('agent commands', () => {
  it('adds a clip as one undo step, and undo removes it', async () => {
    const r = await call('add_clip', { assetId: 'v1', start: 2, inPoint: 1, duration: 4 });
    expect(r.isError).toBe(false);
    expect(r.data).toMatchObject({ type: 'video', start: 2, end: 6, inPoint: 1 });
    expect(steps()).toBe(1);
    await call('undo');
    expect(findClip(rootProject()!, r.data.id)).toBeUndefined();
  });

  it('adds Persian text right-to-left with a style and animation', async () => {
    const r = await call('add_text', { content: 'سلام دنیا', start: 1, duration: 2, color: '#ff8800', animIn: 'pop' });
    const clip = findClip(rootProject()!, r.data.id)!.clip;
    expect(clip.text).toMatchObject({ content: 'سلام دنیا', rtl: true, color: '#ff8800', anim: { in: 'pop' } });
    expect(clip.duration).toBe(2);
  });

  it('rejects bad input without changing the project', async () => {
    const r = await call('add_text', { content: '', color: 'orange' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Invalid arguments');
    expect(steps()).toBe(0);
  });

  it('reports unknown ids in words the agent can act on, and records nothing', async () => {
    const r = await call('update_clip', { clipId: 'nope', transform: { x: 0.2 } });
    expect(r).toMatchObject({ isError: true });
    expect(r.text).toContain('get_project');
    expect(steps()).toBe(0);
  });

  it('splits, moves and deletes', async () => {
    const { data: clip } = await call('add_clip', { assetId: 'v1', start: 0 });
    const { data: split } = await call('split', { time: 4 });
    expect(split.newClipIds).toHaveLength(1);
    const moved = await call('move_clip', { clipId: split.newClipIds[0], start: 12 });
    expect(moved.data.start).toBe(12);
    await call('delete_clips', { clipIds: [clip.id] });
    expect(findClip(rootProject()!, clip.id)).toBeUndefined();
    expect(steps()).toBe(4);
  });

  it('adds effects with checked parameters, and keyframes', async () => {
    const { data: clip } = await call('add_clip', { assetId: 'v1', start: 0 });
    expect((await call('add_effect', { clipIds: [clip.id], kind: 'gaussianBlur', params: { nope: 1 } })).isError).toBe(true);
    const fx = await call('add_effect', { clipIds: [clip.id], kind: 'gaussianBlur' });
    expect(fx.data[0].effectId).toBeTruthy();
    await call('animate', { clipId: clip.id, keyframes: [{ time: 0, values: { scale: 1 } }, { time: 2, values: { scale: 1.5 }, ease: 'linear' }] });
    expect(findClip(rootProject()!, clip.id)!.clip.keyframes).toHaveLength(2);
  });

  it('makes a subtitle track from SRT text', async () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,500\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nWorld\n';
    const r = await call('add_subtitles', { language: 'en', srt });
    expect(r.data.cues).toBe(2);
    const cues = await call('list_cues', {});
    expect(cues.data.cues.map((c: { text: string }) => c.text)).toEqual(['Hello', 'World']);
  });

  it('says so when no project is open', async () => {
    useProjectStore.getState().close();
    const r = await call('get_project');
    expect(r.isError).toBe(true);
    expect(r.text).toContain('No project is open');
  });
});

describe('agent drawing', () => {
  const W = () => rootProject()!.settings.width;

  it('draws a path from SVG data around the transform point, and reads it back', async () => {
    const r = await call('add_shape', { kind: 'path', d: 'M -10 -10 L 30 -10 L 30 10 L -10 10 Z', fill: '#ff000080', transform: { x: 0.1 } });
    expect(r.isError).toBe(false);
    const clip = findClip(rootProject()!, r.data.id)!.clip;
    // The outline's middle (10, 0) is 10 px right of the transform point.
    expect(clip.transform.x).toBeCloseTo(0.1 + 10 / W());
    expect(clip.shape).toMatchObject({ kind: 'path', closed: true, fill: '#ff000080', width: 40, height: 20 });
    expect(clip.shape!.stroke).toBeUndefined();
    const got = await call('get_clip', { clipId: r.data.id });
    expect(got.data.d).toBe('M -20 -10 L 20 -10 L 20 10 L -20 10 Z');
  });

  it('refuses several subpaths and bad data in words the agent can act on', async () => {
    const two = await call('add_shape', { kind: 'path', d: 'M0 0 L10 0 L10 10 Z M20 20 L30 30' });
    expect(two.isError).toBe(true);
    expect(two.text).toContain('group_clips');
    const bad = await call('add_shape', { kind: 'path', d: 'M 0 0 Q 5' });
    expect(bad.text).toContain('Invalid d');
    expect(steps()).toBe(0);
  });

  it('changes an outline, and stroke, shadow and gradient settings', async () => {
    const { data } = await call('add_shape', { kind: 'circle' });
    await call('update_clip', {
      clipId: data.id,
      shape: { points: [{ x: 0, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 0 }], smooth: true, closed: false, stroke: '#000000', lineCap: 'round', shadow: { color: '#00000080', blur: 8, x: 3, y: 4 } },
    });
    const s = findClip(rootProject()!, data.id)!.clip.shape!;
    expect(s).toMatchObject({ kind: 'path', closed: false, stroke: '#000000', cap: 'round', shadowColor: '#00000080', shadowX: 3, shadowY: 4 });
    expect(s.path!.value).toHaveLength(3);
    await call('update_clip', { clipId: data.id, shape: { gradient: { kind: 'linear', to: '#ffffff' }, shadow: null } });
    expect(findClip(rootProject()!, data.id)!.clip.shape).toMatchObject({ gradient: { kind: 'linear', to: '#ffffff', angle: 90 } });
    expect(findClip(rootProject()!, data.id)!.clip.shape!.shadowColor).toBeUndefined();
  });

  it('groups parts, animates a part inside the group, reorders and ungroups', async () => {
    const head = (await call('add_shape', { kind: 'circle', start: 1, duration: 4 })).data;
    const eye = (await call('add_shape', { kind: 'path', d: 'M -30 -10 Q -20 -20 -10 -10', stroke: '#000000', start: 1, duration: 4 })).data;
    // Each overlapping shape got its own graphics track; the eye is on top.
    expect((await call('reorder_clip', { clipId: eye.id, action: 'sendToBack' })).isError).toBe(false);
    expect((await call('reorder_clip', { clipId: eye.id, action: 'sendToBack' })).text).toContain('Nothing to move past');
    await call('reorder_clip', { clipId: eye.id, action: 'bringToFront' });

    const g = await call('group_clips', { clipIds: [head.id, eye.id], name: 'Head' });
    expect(g.data).toMatchObject({ type: 'compound', name: 'Head', start: 1, end: 5 });
    expect(g.data.children).toEqual(expect.arrayContaining([head.id, eye.id]));
    // A part inside the group: timeline times, as before grouping.
    const a = await call('animate', { clipId: eye.id, keyframes: [{ time: 2, values: { opacity: 0 } }, { time: 3, values: { opacity: 1 } }] });
    expect(a.isError).toBe(false);
    const inside = await call('get_clip', { clipId: eye.id });
    expect(inside.data.insideGroup).toBe(true);
    expect(inside.data.keyframes.map((k: { t: number }) => k.t)).toEqual([1, 2]);
    expect((await call('move_clip', { clipId: eye.id, start: 0 })).text).toContain('inside a group');

    const u = await call('ungroup', { groupId: g.data.id });
    expect(u.data.clipIds).toEqual(expect.arrayContaining([head.id, eye.id]));
    expect(findClip(rootProject()!, eye.id)!.clip.start).toBe(1);
    await call('undo');
    expect(findClip(rootProject()!, g.data.id)).toBeTruthy();
  });
});

// The server lists the tools before any tab connects, from this checked-in copy.
// UPDATE_AGENT_TOOLS=1 npx vitest run src/features/agent rewrites it after a change here.
it('server/src/agentTools.json matches the commands', () => {
  const path = 'server/src/agentTools.json';
  const json = JSON.stringify(agentToolList(), null, 2) + '\n';
  if (process.env.UPDATE_AGENT_TOOLS) writeFileSync(path, json);
  expect(readFileSync(path, 'utf8')).toBe(json);
});
