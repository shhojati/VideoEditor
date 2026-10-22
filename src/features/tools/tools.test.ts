import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../../model/factories';
import { findClip } from '../../model/timeline';
import type { Project } from '../../model/types';
import { currentProject, useProjectStore } from '../../store/projectStore';
import { addShape, addText } from '../timeline/actions';
import { useTimelineUi } from '../timeline/timelineUi';
import { finishTextEdit } from './TextEditBox';
import { squareUp } from './ToolOverlay';
import { editText, setTool, shapeToolKey, useTool } from './toolService';

beforeEach(() => {
  const p: Project = createProject('t');
  useProjectStore.getState().load(p);
  useTool.setState({ tool: 'select', shapeKind: 'rectangle', editingText: null });
  useTimelineUi.setState({ selection: [] });
});

describe('tools', () => {
  it('Q picks the shape tool, then steps through the shapes', () => {
    shapeToolKey();
    expect(useTool.getState()).toMatchObject({ tool: 'shape', shapeKind: 'rectangle' });
    shapeToolKey();
    expect(useTool.getState().shapeKind).toBe('square');
  });

  it('the pen needs a clip to draw on', () => {
    setTool('pen');
    expect(useTool.getState().tool).toBe('select');
  });

  it('a dragged box: corners in any order, Shift makes a square on the longer side', () => {
    expect(squareUp({ x: 10, y: 50 }, { x: 0, y: 20 }, false)).toEqual({ cx: 5, cy: 35, w: 10, h: 30 });
    expect(squareUp({ x: 0, y: 0 }, { x: -10, y: 4 }, true)).toEqual({ cx: -5, cy: 5, w: 10, h: 10 });
  });

  it('a shape drawn with the shape tool takes the dragged box', () => {
    addShape('oval', { cx: 300, cy: 200, w: 120, h: 80 });
    const p = currentProject()!;
    const clip = findClip(p, useTimelineUi.getState().selection[0])!.clip;
    expect(clip.shape).toMatchObject({ kind: 'oval', width: 120, height: 80 });
    expect(clip.transform.x).toBeCloseTo((300 - p.settings.width / 2) / p.settings.width);
    expect(clip.transform.y).toBeCloseTo((200 - p.settings.height / 2) / p.settings.height);
  });

  it('a new text left empty is taken back as a whole', () => {
    const before = useProjectStore.getState().history!.past.length;
    const id = addText('', { cx: 10, cy: 10 }, 'k1');
    editText(id, 'k1', true);
    finishTextEdit();
    expect(findClip(currentProject()!, id)).toBeUndefined();
    expect(useProjectStore.getState().history!.past.length).toBe(before);
    expect(useTool.getState().editingText).toBeNull();
  });
});
