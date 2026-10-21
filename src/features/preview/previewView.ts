import { create } from 'zustand';

/** Maps project pixels to viewport CSS pixels: screen = o + k * project. */
export interface View {
  k: number;
  ox: number;
  oy: number;
}

export const ZOOM_PRESETS = [0.25, 0.5, 1, 2, 4] as const;
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;
/** Space around the picture in Fit (CSS px). */
export const FIT_PADDING = 12;

interface Size {
  w: number;
  h: number;
}

/** The whole picture centred in the viewport. */
export function fitView(vp: Size, project: Size): View {
  const aw = Math.max(1, vp.w - 2 * FIT_PADDING);
  const ah = Math.max(1, vp.h - 2 * FIT_PADDING);
  const k = Math.max(MIN_ZOOM / 10, Math.min(aw / project.w, ah / project.h));
  return { k, ox: (vp.w - project.w * k) / 2, oy: (vp.h - project.h * k) / 2 };
}

/**
 * Keep the picture reachable: along an axis where it is smaller than the viewport it is centred;
 * where it is larger it may be panned until a quarter of the viewport lies beyond its edge.
 */
export function clampView(v: View, vp: Size, project: Size): View {
  const axis = (o: number, vpLen: number, len: number) => {
    if (len <= vpLen) return (vpLen - len) / 2;
    const margin = vpLen / 4;
    return Math.min(margin, Math.max(vpLen - len - margin, o));
  };
  return { k: v.k, ox: axis(v.ox, vp.w, project.w * v.k), oy: axis(v.oy, vp.h, project.h * v.k) };
}

/** Zoom to `k` keeping the project point under (px, py) fixed on screen. */
export function zoomAt(v: View, k: number, px: number, py: number): View {
  const nk = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
  return { k: nk, ox: px - ((px - v.ox) / v.k) * nk, oy: py - ((py - v.oy) / v.k) * nk };
}

/** Next preset above (dir 1) or below (dir -1) the current zoom. */
export function stepZoom(k: number, dir: 1 | -1): number {
  const presets = dir > 0 ? ZOOM_PRESETS : [...ZOOM_PRESETS].reverse();
  const next = presets.find((p) => (dir > 0 ? p > k * 1.001 : p < k / 1.001));
  return next ?? (dir > 0 ? Math.min(MAX_ZOOM, k * 2) : Math.max(MIN_ZOOM, k / 2));
}

/**
 * Canvas backing pixels per CSS pixel: devicePixelRatio, but never more backing pixels than project
 * pixels when the picture is shown smaller than 100% (so preview cost follows the panel, not export
 * size). Zoomed in, it stays at the viewport resolution and text/shapes are drawn sharp.
 */
export const backingRatio = (dpr: number, k: number) => Math.min(dpr || 1, Math.max(1, 1 / k));

interface PreviewViewState {
  /** 'fit' follows the viewport size; otherwise the view is kept as set. */
  mode: 'fit' | 'manual';
  view: View;
  viewport: Size;
  project: Size;
}

export const usePreviewView = create<PreviewViewState>()(() => ({
  mode: 'fit',
  view: { k: 1, ox: 0, oy: 0 },
  viewport: { w: 0, h: 0 },
  project: { w: 1920, h: 1080 },
}));

/** Called when the viewport or project size changes. */
export function setViewport(viewport: Size, project: Size) {
  usePreviewView.setState((s) => {
    if (s.mode === 'fit' || s.viewport.w === 0) return { viewport, project, view: fitView(viewport, project), mode: 'fit' };
    // Keep the same picture point at the viewport centre.
    const cx = (s.viewport.w / 2 - s.view.ox) / s.view.k;
    const cy = (s.viewport.h / 2 - s.view.oy) / s.view.k;
    const v = { k: s.view.k, ox: viewport.w / 2 - cx * s.view.k, oy: viewport.h / 2 - cy * s.view.k };
    return { viewport, project, view: clampView(v, viewport, project) };
  });
}

export function zoomToFit() {
  usePreviewView.setState((s) => ({ mode: 'fit', view: fitView(s.viewport, s.project) }));
}

/** Zoom to `k` about a viewport point (default: the centre). */
export function zoomTo(k: number, px?: number, py?: number) {
  usePreviewView.setState((s) => {
    const v = zoomAt(s.view, k, px ?? s.viewport.w / 2, py ?? s.viewport.h / 2);
    return { mode: 'manual', view: clampView(v, s.viewport, s.project) };
  });
}

export function panBy(dx: number, dy: number) {
  usePreviewView.setState((s) => {
    const v = clampView({ k: s.view.k, ox: s.view.ox + dx, oy: s.view.oy + dy }, s.viewport, s.project);
    // Panning a picture that already fits changes nothing; stay in Fit then.
    if (v.ox === s.view.ox && v.oy === s.view.oy) return {};
    return { mode: 'manual', view: v };
  });
}
