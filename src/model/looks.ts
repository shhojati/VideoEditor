// Filters pane: one-tap looks. Each preset is a set of look parameters rendered by the 'look' effect
// (engine/effects), mixed with the original by the filter's intensity.

/** All fields optional; absent = neutral. */
export interface Look {
  /** Stops. */
  exposure?: number;
  /** −1..1 around mid grey. */
  contrast?: number;
  /** Multiplier (1 = unchanged, 0 = grey). */
  saturation?: number;
  /** −1 (cool) .. 1 (warm). */
  temperature?: number;
  /** −1 (green) .. 1 (magenta). */
  tint?: number;
  /** Lifted blacks / lowered whites (0..1): a faded, matte print. */
  fade?: number;
  /** Split toning: colour pushed into shadows / highlights, with strength 0..1. */
  shadowsTint?: [string, number];
  highlightsTint?: [string, number];
  /** 0..1 towards black & white, with the channel mix used for the grey (default luma). */
  mono?: number;
  monoMix?: [number, number, number];
  /** Teal shadows / orange skin and highlights, 0..1. */
  tealOrange?: number;
  /** Darkened corners 0..1. */
  vignette?: number;
  /** Film grain 0..1 (changes every frame). */
  grain?: number;
  /** Soft focus: mix towards a blur (0..1) with this radius (px at 1080p). */
  blur?: number;
  blurRadius?: number;
  /** Bloom of bright areas 0..1. */
  glow?: number;
  /** 0..1. */
  sharpen?: number;
  /** Red/blue fringes (px at 1080p). */
  chromatic?: number;
  /** VHS: scanlines, line wobble and chroma bleed, 0..1. */
  vhs?: number;
  /** Digital glitch: block shifts and colour splits, 0..1. */
  glitch?: number;
  /** Old film: dust, scratches and flicker, 0..1. */
  oldFilm?: number;
}

export type LookCategory = 'popular' | 'life' | 'portrait' | 'movie' | 'aesthetic' | 'bw' | 'retro';

export const LOOKS = {
  // Popular
  cinematic: { contrast: 0.2, saturation: 0.9, tealOrange: 0.45, vignette: 0.35, fade: 0.05 },
  retro: { temperature: 0.35, saturation: 0.8, fade: 0.2, contrast: -0.05, shadowsTint: ['#3a2a60', 0.25], grain: 0.25 },
  vintage: { temperature: 0.4, saturation: 0.65, fade: 0.25, highlightsTint: ['#ffe0a0', 0.3], shadowsTint: ['#402010', 0.2], vignette: 0.4, grain: 0.3 },
  vhs: { vhs: 0.9, saturation: 1.25, chromatic: 3, blur: 0.35, blurRadius: 1.5, contrast: 0.1, fade: 0.08, grain: 0.2 },
  glitch: { glitch: 0.8, chromatic: 6, contrast: 0.15, saturation: 1.2 },
  fade: { fade: 0.35, contrast: -0.15, saturation: 0.8 },
  film: { contrast: 0.12, saturation: 0.85, fade: 0.12, grain: 0.45, temperature: 0.1, vignette: 0.25 },
  blur: { blur: 1, blurRadius: 12 },
  // Life
  warm: { temperature: 0.5, saturation: 1.05, exposure: 0.05 },
  cool: { temperature: -0.5, tint: -0.05, saturation: 0.95 },
  fresh: { exposure: 0.15, saturation: 1.25, contrast: 0.08, temperature: -0.1, tint: -0.08 },
  autumn: { temperature: 0.55, tint: 0.05, saturation: 1.1, highlightsTint: ['#ffb040', 0.3], shadowsTint: ['#5a2a10', 0.2] },
  summer: { exposure: 0.15, temperature: 0.3, saturation: 1.3, contrast: 0.1 },
  winter: { temperature: -0.6, saturation: 0.7, exposure: 0.1, highlightsTint: ['#d8ecff', 0.35] },
  sunset: { temperature: 0.7, tint: 0.15, saturation: 1.2, highlightsTint: ['#ff9050', 0.4], shadowsTint: ['#502060', 0.3], vignette: 0.3 },
  // Portrait
  natural: { exposure: 0.05, contrast: 0.05, saturation: 1.05, temperature: 0.08 },
  glowPortrait: { glow: 0.5, exposure: 0.08, saturation: 1.05, temperature: 0.1 },
  soft: { blur: 0.3, blurRadius: 4, contrast: -0.1, fade: 0.08, exposure: 0.05 },
  smooth: { blur: 0.45, blurRadius: 3, sharpen: 0.2, saturation: 1.02, exposure: 0.06 },
  bright: { exposure: 0.35, contrast: 0.05, saturation: 1.1 },
  // Movie
  cinema: { contrast: 0.25, saturation: 0.85, tealOrange: 0.3, vignette: 0.45, fade: 0.04 },
  tealOrange: { tealOrange: 1, contrast: 0.12 },
  filmGrain: { grain: 0.8, contrast: 0.05 },
  dramatic: { contrast: 0.45, saturation: 0.75, exposure: -0.15, vignette: 0.55, sharpen: 0.3 },
  moody: { exposure: -0.25, saturation: 0.6, contrast: 0.15, shadowsTint: ['#183040', 0.35], fade: 0.1, vignette: 0.4 },
  noir: { mono: 1, monoMix: [0.35, 0.45, 0.2], contrast: 0.55, exposure: -0.1, vignette: 0.6, grain: 0.3 },
  // Aesthetic
  dreamy: { glow: 0.6, blur: 0.25, blurRadius: 6, fade: 0.12, saturation: 0.9, highlightsTint: ['#ffd6f0', 0.3] },
  goldenHour: { temperature: 0.6, exposure: 0.1, highlightsTint: ['#ffc060', 0.45], glow: 0.25, saturation: 1.1 },
  pastel: { fade: 0.25, saturation: 0.6, exposure: 0.2, contrast: -0.2, highlightsTint: ['#ffe8f4', 0.25], shadowsTint: ['#c8e0ff', 0.25] },
  matte: { fade: 0.3, contrast: -0.05, saturation: 0.85 },
  faded: { fade: 0.45, saturation: 0.55, contrast: -0.2 },
  softFocus: { blur: 0.55, blurRadius: 8, glow: 0.3 },
  // Black & White
  mono: { mono: 1 },
  bw: { mono: 1, contrast: 0.25 },
  classic: { mono: 1, monoMix: [0.4, 0.4, 0.2], contrast: 0.15, fade: 0.1, grain: 0.2, vignette: 0.3 },
  silver: { mono: 1, monoMix: [0.25, 0.5, 0.25], exposure: 0.1, contrast: 0.2, highlightsTint: ['#e8f0ff', 0.25] },
  // Retro
  nineties: { saturation: 1.15, contrast: 0.1, temperature: 0.15, tint: 0.1, fade: 0.15, chromatic: 1.5, grain: 0.2 },
  oldFilm: { oldFilm: 0.9, mono: 0.7, monoMix: [0.4, 0.4, 0.2], temperature: 0.4, fade: 0.2, grain: 0.6, vignette: 0.6 },
  polaroid: { fade: 0.2, temperature: 0.2, saturation: 0.85, highlightsTint: ['#fff4d8', 0.3], shadowsTint: ['#20403a', 0.25], contrast: 0.05 },
  retroFade: { fade: 0.4, temperature: 0.3, saturation: 0.7, shadowsTint: ['#402060', 0.3] },
} satisfies Record<string, Look>;

export type LookId = keyof typeof LOOKS;
export const LOOK_IDS = Object.keys(LOOKS) as LookId[];

/** The Filters pane. Noir and VHS appear in two groups, as in the brief. */
export const LOOK_MENU: readonly { category: LookCategory; ids: readonly LookId[] }[] = [
  { category: 'popular', ids: ['cinematic', 'retro', 'vintage', 'vhs', 'glitch', 'fade', 'film', 'blur'] },
  { category: 'life', ids: ['warm', 'cool', 'fresh', 'autumn', 'summer', 'winter', 'sunset'] },
  { category: 'portrait', ids: ['natural', 'glowPortrait', 'soft', 'smooth', 'bright'] },
  { category: 'movie', ids: ['cinema', 'tealOrange', 'filmGrain', 'dramatic', 'moody', 'noir'] },
  { category: 'aesthetic', ids: ['dreamy', 'goldenHour', 'pastel', 'matte', 'faded', 'softFocus'] },
  { category: 'bw', ids: ['mono', 'noir', 'bw', 'classic', 'silver'] },
  { category: 'retro', ids: ['nineties', 'oldFilm', 'vhs', 'polaroid', 'retroFade'] },
];

export const lookOf = (id: string): Look => (LOOKS as Record<string, Look>)[id] ?? {};
