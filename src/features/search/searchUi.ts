import { create } from 'zustand';

/**
 * The top bar's search box: `expanded` opens it over the bar on phones; Ctrl+K bumps
 * `focusRequest` and the box takes focus.
 */
export const useSearchUi = create<{ focusRequest: number; expanded: boolean }>()(() => ({
  focusRequest: 0,
  expanded: false,
}));

export const focusSearch = () =>
  useSearchUi.setState((s) => ({ focusRequest: s.focusRequest + 1, expanded: true }));
