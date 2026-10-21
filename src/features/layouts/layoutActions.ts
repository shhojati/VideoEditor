import { applyLayout, type Layout } from '../../model/layouts';
import type { ID } from '../../model/types';
import { useProjectStore } from '../../store/projectStore';
import { select, useTimelineUi } from '../timeline/timelineUi';

/** Arrange the selected video and image clips in a layout (one undo step). */
export function applyLayoutToSelection(layout: Layout) {
  const selection = useTimelineUi.getState().selection;
  let ids: ID[] = [];
  useProjectStore.getState().edit('ops.applyLayout', (d) => void (ids = applyLayout(d, layout, selection)));
  if (ids.length) select(ids);
}
