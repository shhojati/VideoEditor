// Runs a clip's effect stack on its layer (a canvas the size of the output, already holding the
// clip as drawn), on the GPU, and writes the result back into the layer.
import { EFFECT_DEFS, param, transitionCompletion } from '../../model/effects';
import { lookOf } from '../../model/looks';
import type { Effect } from '../../model/types';
import { Gl, type Target, type Uniform } from './gl';
import { columnMajor, curveLut, homography, invert2, levelsLut, particlesAt, transformMatrix } from './math';
import * as S from './shaders';

export interface FxEnv {
  /** Clip id: keys the frame history of Echo / Posterize Time. */
  key: string;
  /** Timeline time and time since the clip start (s), and the clip's length. */
  time: number;
  local: number;
  duration: number;
  /** Canvas pixels per project pixel. */
  scale: number;
  /** Canvas pixels per pixel of a 1080-pixel short side (filters are tuned at 1080p). */
  unit: number;
  /** The project frame on the canvas (top-left origin, canvas pixels). */
  frame: { x: number; y: number; w: number; h: number };
  /** What is under the clip (Displacement Map's "layer below"). */
  below?: CanvasImageSource;
}

export const isLive = (e: Effect) => e.enabled && !EFFECT_DEFS[e.kind].later;
export const hasLiveEffects = (effects: readonly Effect[] | undefined) => !!effects?.some(isLive);

let gl: Gl | null | undefined;
let warned = false;
function context(): Gl | null {
  if (gl === undefined) gl = Gl.create();
  if (!gl && !warned) {
    warned = true;
    console.warn('WebGL2 is not available: effects and filters are skipped');
  }
  return gl;
}

const rgbOf = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6), 16) || 0;
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};
/** Direction for an angle in degrees clockwise from up, in y-up pixel space. */
const dirOf = (deg: number): [number, number] => [Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)];
const CHANNEL: Record<string, [number, number, number]> = { red: [1, 0, 0], green: [0, 1, 0], blue: [0, 0, 1], luminance: [0.299, 0.587, 0.114], rgb: [1, 1, 1] };

// ---- frame history (Echo, Posterize Time) --------------------------------------------------------

interface Snapshot {
  time: number;
  target: Target;
}
const history = new Map<string, Snapshot[]>();
const held = new Map<string, { bucket: number; target: Target }>();
let historySize = '';
const MAX_SNAPSHOTS = 16;

function forgetHistory(g: Gl) {
  for (const list of history.values()) for (const s of list) g.release(s.target);
  for (const h of held.values()) g.release(h.target);
  history.clear();
  held.clear();
}

/**
 * Apply `effects` in order to `layer`, in place. Returns false (layer untouched) when WebGL2 is
 * unavailable.
 */
export function applyEffects(layer: OffscreenCanvas, effects: readonly Effect[], env: FxEnv): boolean {
  const g = context();
  if (!g) return false;
  const size = `${layer.width}x${layer.height}`;
  if (size !== historySize) {
    forgetHistory(g);
    historySize = size;
  }
  g.resize(layer.width, layer.height);
  const H = layer.height;
  const frame: [number, number, number, number] = [env.frame.x, H - env.frame.y - env.frame.h, env.frame.w, env.frame.h];
  const base = { u_frame: frame };
  const run = (frag: string, src: WebGLTexture, uniforms: Record<string, Uniform> = {}, textures: Record<string, WebGLTexture> = {}) => {
    const out = g.acquire();
    g.run(frag, { u_src: src, ...textures }, { ...base, ...uniforms }, out);
    return out;
  };
  const px = (v: number) => v * env.scale;
  const pt = (e: Effect, key: string): [number, number] => [env.frame.x + param<number>(e, `${key}X`) * env.frame.w, H - (env.frame.y + param<number>(e, `${key}Y`) * env.frame.h)];
  const blur = (src: Target, sigma: number, dims = 'both', edge = false) => {
    const a = run(S.GAUSS, src.tex, { u_dir: [1, 0], u_sigma: dims === 'vertical' ? 0 : sigma, u_edge: edge });
    const b = run(S.GAUSS, a.tex, { u_dir: [0, 1], u_sigma: dims === 'horizontal' ? 0 : sigma, u_edge: edge });
    g.release(a);
    return b;
  };

  let cur = run(S.COPY, g.upload(layer, 0));
  /** Replace the current image with `next`. */
  const step = (next: Target) => {
    g.release(cur);
    cur = next;
  };

  for (const e of effects) {
    if (!isLive(e)) continue;
    const n = (k: string) => param<number>(e, k);
    const s = (k: string) => param<string>(e, k);
    const b = (k: string) => param<boolean>(e, k);
    const c = (k: string) => rgbOf(s(k));
    switch (e.kind) {
      case 'gaussianBlur':
        step(blur(cur, px(n('blurriness')) / 2, s('dimensions'), b('repeatEdge')));
        break;
      case 'fastBoxBlur': {
        for (let i = 0; i < Math.round(n('iterations')); i++) {
          const r = px(n('radius')) / Math.sqrt(Math.max(1, n('iterations')));
          const dims = s('dimensions');
          const a = run(S.BOX, cur.tex, { u_dir: [1, 0], u_radius: dims === 'vertical' ? 0 : r, u_edge: b('repeatEdge') });
          step(a);
          step(run(S.BOX, cur.tex, { u_dir: [0, 1], u_radius: dims === 'horizontal' ? 0 : r, u_edge: b('repeatEdge') }));
        }
        break;
      }
      case 'cameraLensBlur':
        step(run(S.LENS_BLUR, cur.tex, { u_radius: px(n('radius')), u_gain: n('highlightGain') / 100, u_thresh: n('highlightThreshold') / 100, u_hex: s('iris') === 'hexagon' }));
        break;
      case 'directionalBlur':
        step(run(S.DIRECTIONAL_BLUR, cur.tex, { u_dir: dirOf(n('direction')), u_length: px(n('length')) }));
        break;
      case 'sharpen':
        step(run(S.SHARPEN, cur.tex, { u_amount: n('amount') }));
        break;
      case 'unsharpMask': {
        const bl = blur(cur, px(n('radius')));
        step(run(S.UNSHARP, cur.tex, { u_amount: n('amount'), u_threshold: n('threshold') }, { u_aux: bl.tex }));
        g.release(bl);
        break;
      }
      case 'lumetri':
        step(run(S.LUMETRI, cur.tex, Object.fromEntries(['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temperature', 'tint', 'saturation', 'vibrance', 'vignette'].map((k) => [`u_${k}`, n(k)]))));
        break;
      case 'curves':
      case 'levels': {
        const lut =
          e.kind === 'curves'
            ? curveLut(['p0', 'p25', 'p50', 'p75', 'p100'].map((k) => n(k) / 100))
            : levelsLut(n('inBlack'), n('inWhite'), n('gamma'), n('outBlack'), n('outWhite'));
        step(run(S.LUT, cur.tex, { u_mask: CHANNEL[s('channel')] ?? [1, 1, 1] }, { u_lut: g.uploadLut(lut, 3) }));
        break;
      }
      case 'hueSaturation':
        step(run(S.HUE_SAT, cur.tex, { u_hue: n('hue'), u_saturation: n('saturation'), u_lightness: n('lightness'), u_colorize: b('colorize'), u_colorizeHue: n('colorizeHue'), u_colorizeSaturation: n('colorizeSaturation') }));
        break;
      case 'tint':
        step(run(S.TINT, cur.tex, { u_black: c('mapBlack'), u_white: c('mapWhite'), u_amount: n('amount') }));
        break;
      case 'tritone':
        step(run(S.TRITONE, cur.tex, { u_hi: c('highlights'), u_mid: c('midtones'), u_lo: c('shadows'), u_blend: n('blend') }));
        break;
      case 'brightnessContrast':
        step(run(S.BRIGHT_CONTRAST, cur.tex, { u_brightness: n('brightness'), u_contrast: n('contrast') }));
        break;
      case 'posterize':
        step(run(S.POSTERIZE, cur.tex, { u_levels: Math.max(2, Math.round(n('levels'))) }));
        break;
      case 'mosaic': {
        const size = Math.max(1, px(n('blockSize')));
        step(run(S.MOSAIC, cur.tex, { u_block: [size, size], u_sharp: b('sharpColors') }));
        break;
      }
      case 'fill':
        step(run(S.FILL, cur.tex, { u_color: c('color'), u_opacity: n('opacity') / 100 }));
        break;
      case 'transform': {
        const m = transformMatrix(n('scale') / 100, n('rotation'), n('skew'), n('skewAxis'));
        const inv = invert2(m);
        const anchor: [number, number] = [frame[0] + frame[2] / 2, frame[1] + frame[3] / 2];
        // Column-major mat2 for GLSL: (a, c, b, d).
        step(run(S.AFFINE, cur.tex, { u_inv: [inv[0], inv[2], inv[1], inv[3]], u_anchor: anchor, u_pos: pt(e, 'position'), u_opacity: n('opacity') / 100 }));
        break;
      }
      case 'turbulentDisplace':
        step(run(S.TURBULENT, cur.tex, { u_amount: px(n('amount')), u_size: Math.max(1, px(n('size'))), u_complexity: n('complexity'), u_evolution: (n('evolution') + n('speed') * env.local) / 90 }));
        break;
      case 'displacementMap': {
        const map = s('map') === 'below' && env.below ? g.upload(env.below as TexImageSource, 1) : cur.tex;
        step(run(S.DISPLACE, cur.tex, { u_chanX: CHANNEL[s('horizontal')], u_chanY: CHANNEL[s('vertical')], u_max: [px(n('maxHorizontal')), px(n('maxVertical'))] }, { u_map: map }));
        break;
      }
      case 'opticsCompensation':
        step(run(S.OPTICS, cur.tex, { u_fov: (n('fieldOfView') * Math.PI) / 180, u_reverse: b('reverse') }));
        break;
      case 'powerPin': {
        // Output quad (the pins) → source frame rectangle.
        const [fx, fy, fw, fh] = frame;
        const src: [number, number][] = [[fx, fy + fh], [fx + fw, fy + fh], [fx, fy], [fx + fw, fy]];
        const dst = [pt(e, 'topLeft'), pt(e, 'topRight'), pt(e, 'bottomLeft'), pt(e, 'bottomRight')];
        step(run(S.HOMOGRAPHY, cur.tex, { u_h: columnMajor(homography(dst, src)) }));
        break;
      }
      case 'gradientRamp':
        step(run(S.RAMP, cur.tex, { u_start: pt(e, 'start'), u_end: pt(e, 'end'), u_c0: c('startColor'), u_c1: c('endColor'), u_radial: s('shape') === 'radial', u_blend: n('blend') }));
        break;
      case 'fourColorGradient':
        step(run(S.FOUR_COLOR, cur.tex, { u_p1: pt(e, 'point1'), u_p2: pt(e, 'point2'), u_p3: pt(e, 'point3'), u_p4: pt(e, 'point4'), u_c1: c('color1'), u_c2: c('color2'), u_c3: c('color3'), u_c4: c('color4'), u_blend: n('blend'), u_opacity: n('opacity') }));
        break;
      case 'grid':
        step(run(S.GRID, cur.tex, { u_size: Math.max(2, px(n('size'))), u_border: px(n('border')), u_color: c('color'), u_opacity: n('opacity'), u_invert: b('invert') }));
        break;
      case 'lensFlare':
        step(run(S.LENS_FLARE, cur.tex, { u_centre: pt(e, 'center'), u_brightness: n('brightness'), u_lens: ['zoom', 'prime35', 'prime105'].indexOf(s('lens')) }));
        break;
      case 'stroke':
        step(run(S.STROKE, cur.tex, { u_color: c('color'), u_size: px(n('size')), u_opacity: n('opacity'), u_only: s('paint') === 'strokeOnly' }));
        break;
      case 'glow': {
        const bright = run(S.BRIGHT_PASS, cur.tex, { u_threshold: n('threshold') / 100, u_useColor: s('colors') === 'color', u_color: c('color') });
        const bl = blur(bright, px(n('radius')) / 2);
        g.release(bright);
        step(run(S.ADD, cur.tex, { u_amount: n('intensity') }, { u_aux: bl.tex }));
        g.release(bl);
        break;
      }
      case 'dropShadow': {
        const [dx, dy] = dirOf(n('direction'));
        const shape = run(S.SHADOW_SHAPE, cur.tex, { u_offset: [dx * px(n('distance')), dy * px(n('distance'))], u_color: c('color'), u_opacity: n('opacity') / 100 });
        const soft = blur(shape, px(n('softness')) / 2);
        g.release(shape);
        step(run(S.SHADOW_COMBINE, soft.tex, { u_only: b('shadowOnly') }, { u_aux: cur.tex }));
        g.release(soft);
        break;
      }
      case 'motionTile':
        step(run(S.MOTION_TILE, cur.tex, { u_centre: pt(e, 'center'), u_tile: [(frame[2] * n('tileWidth')) / 100, (frame[3] * n('tileHeight')) / 100], u_mirror: b('mirror') }));
        break;
      case 'roughenEdges': {
        const bl = blur(cur, Math.max(0.5, px(n('border')) / 2));
        step(run(S.ROUGHEN, cur.tex, { u_sharpness: n('sharpness'), u_scale: Math.max(1, px(40) * (n('scale') / 100)), u_evolution: n('evolution') / 45 }, { u_aux: bl.tex }));
        g.release(bl);
        break;
      }
      case 'findEdges':
        step(run(S.FIND_EDGES, cur.tex, { u_invert: b('invert'), u_blend: n('blend') }));
        break;
      case 'bevelAlpha': {
        const bl = blur(cur, Math.max(0.5, px(n('thickness')) / 2));
        step(run(S.BEVEL, cur.tex, { u_light: dirOf(n('lightAngle')), u_lightColor: c('lightColor'), u_intensity: n('intensity') / 100, u_thickness: px(n('thickness')) }, { u_aux: bl.tex }));
        g.release(bl);
        break;
      }
      case 'sphere':
        step(run(S.SPHERE, cur.tex, { u_centre: pt(e, 'center'), u_radius: Math.max(1, (Math.min(frame[2], frame[3]) * n('radius')) / 200), u_rotX: (n('rotationX') * Math.PI) / 180, u_rotY: (n('rotationY') * Math.PI) / 180, u_light: n('light') / 100 }));
        break;
      case 'linearColorKey': {
        const key = c('keyColor');
        const dom = key.indexOf(Math.max(...key));
        step(run(S.LINEAR_KEY, cur.tex, { u_key: key, u_dominant: [dom === 0 ? 1 : 0, dom === 1 ? 1 : 0, dom === 2 ? 1 : 0], u_tolerance: n('tolerance') / 100, u_softness: n('softness') / 100, u_spill: n('spill') / 100 }));
        break;
      }
      case 'colorRange': {
        const [r, gg, bb] = c('keyColor');
        const mx = Math.max(r, gg, bb);
        const d = mx - Math.min(r, gg, bb);
        const hue = d === 0 ? 0 : (((mx === r ? (gg - bb) / d + (gg < bb ? 6 : 0) : mx === gg ? (bb - r) / d + 2 : (r - gg) / d + 4) / 6) % 1);
        step(run(S.COLOR_RANGE, cur.tex, { u_hue: hue, u_hueRange: n('hueRange') / 180, u_minSat: n('minSaturation') / 100, u_minL: n('minLightness') / 100, u_maxL: n('maxLightness') / 100, u_softness: n('softness') / 100 }));
        break;
      }
      case 'linearWipe':
      case 'radialWipe':
      case 'venetianBlinds':
      case 'blockDissolve':
      case 'gradientWipe': {
        const completion = transitionCompletion(e, env.local, env.duration);
        if (e.kind === 'linearWipe') step(run(S.LINEAR_WIPE, cur.tex, { u_dir: dirOf(n('angle')), u_completion: completion, u_feather: px(n('feather')) }));
        else if (e.kind === 'radialWipe')
          step(run(S.RADIAL_WIPE, cur.tex, { u_centre: pt(e, 'center'), u_completion: completion, u_start: (n('startAngle') * Math.PI) / 180, u_mode: ['clockwise', 'counterclockwise', 'both'].indexOf(s('wipe')), u_feather: n('feather') }));
        else if (e.kind === 'venetianBlinds') step(run(S.BLINDS, cur.tex, { u_dir: dirOf(n('direction')), u_completion: completion, u_width: Math.max(1, px(n('width'))), u_feather: px(n('feather')) }));
        else if (e.kind === 'blockDissolve') step(run(S.BLOCKS, cur.tex, { u_block: [Math.max(1, px(n('blockWidth'))), Math.max(1, px(n('blockHeight')))], u_completion: completion, u_feather: n('feather') / 100 }));
        else step(run(S.GRADIENT_WIPE, cur.tex, { u_completion: completion, u_softness: n('softness') / 100, u_mode: ['luminance', 'horizontal', 'vertical', 'radial', 'noise'].indexOf(s('gradient')), u_invert: b('invert') }));
        break;
      }
      case 'echo': {
        const k = `${env.key}:${e.id}`;
        let list = history.get(k) ?? [];
        // A jump backwards (seek) invalidates what was recorded.
        if (list.length && list[list.length - 1].time > env.time + 1e-6) {
          list.forEach((x) => g.release(x.target));
          list = [];
        }
        const dt = n('echoTime');
        const count = Math.round(n('echoes'));
        let acc = run(S.SCALE, cur.tex, { u_k: n('startIntensity') / 100 });
        if (dt < 0)
          for (let i = 1; i <= count; i++) {
            const want = env.time + i * dt;
            const snap = list.reduce<Snapshot | null>((best, x) => (Math.abs(x.time - want) < Math.abs((best?.time ?? Infinity) - want) ? x : best), null);
            if (!snap || Math.abs(snap.time - want) > Math.max(0.05, -dt / 2)) continue;
            const w = (n('startIntensity') / 100) * Math.pow(n('decay') / 100, i);
            const next = run(S.ECHO, acc.tex, { u_weight: w, u_op: ['add', 'maximum', 'minimum', 'screen', 'behind', 'front'].indexOf(s('operator')) }, { u_aux: snap.target.tex });
            g.release(acc);
            acc = next;
          }
        // Record this frame (before echoing) and drop what is too old to be needed.
        list.push({ time: env.time, target: run(S.COPY, cur.tex) });
        const oldest = env.time + Math.min(0, dt) * count - 0.1;
        while (list.length > MAX_SNAPSHOTS || (list.length && list[0].time < oldest)) g.release(list.shift()!.target);
        history.set(k, list);
        step(acc);
        break;
      }
      case 'posterizeTime': {
        const k = `${env.key}:${e.id}`;
        const bucket = Math.floor(env.time * Math.max(1, n('frameRate')) + 1e-6);
        const h = held.get(k);
        if (h && h.bucket === bucket) step(run(S.COPY, h.target.tex));
        else {
          g.release(h?.target);
          held.set(k, { bucket, target: run(S.COPY, cur.tex) });
        }
        break;
      }
      case 'particleWorld':
      case 'particleSystems': {
        const sprite = drawParticles(e, env, layer.width, layer.height);
        step(run(S.OVER, g.upload(sprite, 2), {}, { u_dst: cur.tex }));
        break;
      }
      case 'look':
        step(look(g, run, blur, cur, e, env));
        break;
    }
  }

  g.run(S.COPY, { u_src: cur.tex }, base, null);
  g.release(cur);
  const ctx = layer.getContext('2d')!;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(g.canvas, 0, 0);
  ctx.restore();
  return true;
}

type Run = (frag: string, src: WebGLTexture, uniforms?: Record<string, Uniform>, textures?: Record<string, WebGLTexture>) => Target;

function look(g: Gl, run: Run, blur: (t: Target, sigma: number) => Target, cur: Target, e: Effect, env: FxEnv): Target {
  const L = lookOf(param<string>(e, 'preset'));
  const radius = Math.max(L.blur ? (L.blurRadius ?? 4) : 0, L.glow ? 12 : 0, L.sharpen ? 1.5 : 0);
  const aux = radius > 0 ? blur(cur, radius * env.unit) : null;
  const tint = (t: [string, number] | undefined) => (t ? [...rgbOf(t[0]), t[1]] : [0.5, 0.5, 0.5, 0]);
  const out = run(
    S.LOOK,
    cur.tex,
    {
      u_intensity: param<number>(e, 'intensity') / 100,
      u_unit: env.unit,
      u_time: env.time,
      u_exposure: L.exposure ?? 0,
      u_contrast: L.contrast ?? 0,
      u_saturation: L.saturation ?? 1,
      u_temperature: L.temperature ?? 0,
      u_tint: L.tint ?? 0,
      u_fade: L.fade ?? 0,
      u_mono: L.mono ?? 0,
      u_monoMix: L.monoMix ?? [0.299, 0.587, 0.114],
      u_tealOrange: L.tealOrange ?? 0,
      u_vignette: L.vignette ?? 0,
      u_grain: L.grain ?? 0,
      u_blur: L.blur ?? 0,
      u_glow: L.glow ?? 0,
      u_sharpen: L.sharpen ?? 0,
      u_chromatic: L.chromatic ?? 0,
      u_vhs: L.vhs ?? 0,
      u_glitch: L.glitch ?? 0,
      u_oldFilm: L.oldFilm ?? 0,
      u_shadowsTint: tint(L.shadowsTint),
      u_highlightsTint: tint(L.highlightsTint),
    },
    { u_aux: (aux ?? cur).tex },
  );
  g.release(aux);
  return out;
}

let sprite: OffscreenCanvas | null = null;

/** Particles drawn with the 2D canvas (soft discs, colour from birth to death). */
function drawParticles(e: Effect, env: FxEnv, w: number, h: number): OffscreenCanvas {
  if (!sprite) sprite = new OffscreenCanvas(w, h);
  if (sprite.width !== w || sprite.height !== h) {
    sprite.width = w;
    sprite.height = h;
  }
  const ctx = sprite.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  const n = (k: string) => param<number>(e, k);
  const world = e.kind === 'particleWorld';
  const diag = Math.hypot(env.frame.w, env.frame.h);
  const parts = particlesAt(env.local, {
    x: env.frame.x + n('producerX') * env.frame.w,
    y: env.frame.y + n('producerY') * env.frame.h,
    birthRate: n('birthRate'),
    longevity: n('longevity'),
    velocity: (n('velocity') / 100) * diag * 0.3,
    spread: world ? 360 : n('spread'),
    gravity: (n('gravity') / 100) * diag * 0.4,
    size: n('size') * env.scale,
    depth: world ? n('depth') / 100 : 0,
  });
  const from = rgbOf(param<string>(e, 'birthColor'));
  const to = rgbOf(param<string>(e, 'deathColor'));
  ctx.globalCompositeOperation = 'lighter';
  for (const p of parts) {
    const col = from.map((v, i) => Math.round((v + (to[i] - v) * p.age) * 255));
    const alpha = Math.sin(Math.PI * Math.min(1, p.age * 1.2 + 0.05)) * (world ? 0.5 + 0.5 * p.z : 1);
    const r = Math.max(0.5, p.size / 2);
    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    grad.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${alpha})`);
    grad.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(p.x - r, p.y - r, 2 * r, 2 * r);
  }
  ctx.globalCompositeOperation = 'source-over';
  return sprite;
}
