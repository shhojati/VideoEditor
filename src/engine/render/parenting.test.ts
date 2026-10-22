import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../../model/factories';
import { addNullClip, addShapeClip, addSolidClip, findClip, moveTrack } from '../../model/timeline';
import { defaultShape, isOverlay } from '../../model/overlays';
import type { Project, Transform } from '../../model/types';
import { parseProject } from '../../model/validate';
import { currentProject, useProjectStore } from '../../store/projectStore';
import { useTransport } from '../../store/transport';
import { setParent } from '../../features/timeline/parentActions';
import { drawnClip, toLocal, toWorld, wouldCycle } from './parenting';

const W = 1920;
const H = 1080;

function setup() {
  const p: Project = createProject('t');
  p.settings.width = W;
  p.settings.height = H;
  const nul = addNullClip(p, 0);
  const shape = addShapeClip(p, 0, defaultShape('star'));
  useProjectStore.getState().load(p);
  useTransport.getState().seek(1);
  return { nul, shape };
}

const at = (tr: Transform) => ({ x: W / 2 + tr.x * W, y: H / 2 + tr.y * H });

describe('parenting', () => {
  beforeEach(() => useTransport.getState().seek(0));

  it('local ↔ world are inverse, with a turned and scaled parent', () => {
    const p = createProject('t');
    const pose = { x: 300, y: 200, rotation: 30, scale: 2 };
    const world: Transform = { x: 0.1, y: -0.2, scale: 0.7, rotation: 10, opacity: 1 };
    const back = toWorld(p, toLocal(p, world, pose), pose);
    expect(back.x).toBeCloseTo(world.x);
    expect(back.y).toBeCloseTo(world.y);
    expect(back.rotation).toBeCloseTo(10);
    expect(back.scale).toBeCloseTo(0.7);
  });

  it('attaching keeps the child where it is; then it follows the parent', () => {
    const { nul, shape } = setup();
    let p = currentProject()!;
    const before = at(drawnClip(p, findClip(p, shape)!.clip, 1).transform);
    useProjectStore.getState().edit('move null', (d) => void (findClip(d, nul)!.clip.transform.x = 0.25));
    setParent(shape, nul);
    p = currentProject()!;
    expect(findClip(p, shape)!.clip.parentId).toBe(nul);
    const attached = at(drawnClip(p, findClip(p, shape)!.clip, 1).transform);
    expect(attached.x).toBeCloseTo(before.x);
    expect(attached.y).toBeCloseTo(before.y);
    // Turn the null by 90° and move it: the child goes round it and turns too.
    useProjectStore.getState().edit('turn null', (d) => {
      const c = findClip(d, nul)!.clip;
      c.transform.rotation = 90;
      c.transform.x = 0;
    });
    p = currentProject()!;
    const child = drawnClip(p, findClip(p, shape)!.clip, 1).transform;
    // It was 0.25 W to the left of the null (at the centre then); now 0.25 W above it.
    expect(at(child).x).toBeCloseTo(W / 2);
    expect(at(child).y).toBeCloseTo(H / 2 - 0.25 * W);
    expect(child.rotation).toBeCloseTo(90);
    // Detaching keeps it there.
    setParent(shape, null);
    p = currentProject()!;
    const free = findClip(p, shape)!.clip;
    expect(free.parentId).toBeUndefined();
    expect(at(free.transform).y).toBeCloseTo(H / 2 - 0.25 * W);
  });

  it('no loops', () => {
    const { nul, shape } = setup();
    setParent(shape, nul);
    expect(wouldCycle(currentProject()!, nul, shape)).toBe(true);
    setParent(nul, shape);
    expect(findClip(currentProject()!, nul)!.clip.parentId).toBeUndefined();
  });

  it('tracks move within their group; solids and nulls are overlays and survive saving', () => {
    const p = createProject('t');
    const solid = addSolidClip(p, 0, '#ff0000');
    const nul = addNullClip(p, 0);
    expect(isOverlay(findClip(p, solid)!.clip) && isOverlay(findClip(p, nul)!.clip)).toBe(true);
    // [audio, video, graphics(solid), graphics(null)]: the top track goes down, audio stays put.
    const top = p.tracks.at(-1)!.id;
    expect(moveTrack(p, top, -1)).toBe(true);
    expect(p.tracks.at(-2)!.id).toBe(top);
    expect(moveTrack(p, p.tracks[1].id, -1)).toBe(false);
    expect(moveTrack(p, p.tracks[0].id, 1)).toBe(false);
    findClip(p, solid)!.clip.parentId = nul;
    const back = parseProject(JSON.parse(JSON.stringify(p)));
    expect(findClip(back, solid)!.clip).toMatchObject({ solid: { color: '#ff0000' }, parentId: nul });
    expect(findClip(back, nul)!.clip.nullObject).toBe(true);
  });
});
