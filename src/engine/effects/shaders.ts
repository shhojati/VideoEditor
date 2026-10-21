// GLSL for the effect passes. Every shader gets the prelude: pixel-space sampling helpers on
// premultiplied textures, colour conversions and noise. Coordinates are in pixels with y up;
// u_frame is the project frame on the canvas (x, y, w, h) in the same space.

const PRELUDE = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_res;
uniform vec4 u_frame;
out vec4 o;
vec4 at(vec2 p) { return texture(u_src, p / u_res); }
vec4 sampleOf(sampler2D s, vec2 p) { return texture(s, p / u_res); }
bool outside(vec2 p) { return p.x < 0.0 || p.y < 0.0 || p.x > u_res.x || p.y > u_res.y; }
vec4 at0(vec2 p) { return outside(p) ? vec4(0.0) : at(p); }
vec3 unpre(vec4 c) { return c.a > 1e-5 ? c.rgb / c.a : vec3(0.0); }
vec4 pre(vec3 rgb, float a) { return vec4(clamp(rgb, 0.0, 1.0) * a, a); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec2 frameCentre() { return u_frame.xy + 0.5 * u_frame.zw; }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p, float octaves) {
  float v = 0.0, a = 0.5;
  for (float i = 0.0; i < 6.0; i++) { if (i >= octaves) break; v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v / (1.0 - pow(0.5, max(octaves, 1.0)));
}
vec3 rgb2hsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float l = (mx + mn) * 0.5, d = mx - mn, h = 0.0, s = 0.0;
  if (d > 1e-5) {
    s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
    if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, s, l);
}
float hue2rgb(float p, float q, float t) {
  t = fract(t);
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}
vec3 hsl2rgb(vec3 c) {
  if (c.y < 1e-5) return vec3(c.z);
  float q = c.z < 0.5 ? c.z * (1.0 + c.y) : c.z + c.y - c.z * c.y, p = 2.0 * c.z - q;
  return vec3(hue2rgb(p, q, c.x + 1.0 / 3.0), hue2rgb(p, q, c.x), hue2rgb(p, q, c.x - 1.0 / 3.0));
}
`;

const fs = (body: string) => PRELUDE + body;

/** Copy (used to snapshot or to present a target). */
export const COPY = fs(`void main() { o = at(gl_FragCoord.xy); }`);

/** Source over: u_src over u_dst. */
export const OVER = fs(`uniform sampler2D u_dst;
void main() { vec2 p = gl_FragCoord.xy; vec4 s = at(p), d = sampleOf(u_dst, p); o = s + d * (1.0 - s.a); }`);

// ---- blur & sharpen ----------------------------------------------------------------------------

/** One direction of a Gaussian; large radii take every n-th tap (bilinear keeps it smooth). */
export const GAUSS = fs(`uniform vec2 u_dir; uniform float u_sigma; uniform float u_edge;
void main() {
  vec2 p = gl_FragCoord.xy;
  if (u_sigma < 0.3) { o = at(p); return; }
  float r = ceil(u_sigma * 3.0), stp = max(1.0, ceil(r / 48.0));
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (float i = -r; i <= r; i += stp) {
    float w = exp(-0.5 * i * i / (u_sigma * u_sigma));
    vec2 q = p + u_dir * i;
    acc += (u_edge > 0.5 ? at(q) : at0(q)) * w; ws += w;
  }
  o = acc / ws;
}`);

export const BOX = fs(`uniform vec2 u_dir; uniform float u_radius; uniform float u_edge;
void main() {
  vec2 p = gl_FragCoord.xy;
  if (u_radius < 0.5) { o = at(p); return; }
  float stp = max(1.0, ceil(u_radius / 48.0));
  vec4 acc = vec4(0.0); float n = 0.0;
  for (float i = -u_radius; i <= u_radius; i += stp) { vec2 q = p + u_dir * i; acc += u_edge > 0.5 ? at(q) : at0(q); n += 1.0; }
  o = acc / n;
}`);

/** Bokeh: a disc (or hexagon) of samples on a golden-angle spiral; bright samples weigh more. */
export const LENS_BLUR = fs(`uniform float u_radius, u_gain, u_thresh, u_hex;
void main() {
  vec2 p = gl_FragCoord.xy;
  if (u_radius < 0.5) { o = at(p); return; }
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (float i = 0.0; i < 128.0; i++) {
    float a = i * 2.39996323, r = sqrt((i + 0.5) / 128.0) * u_radius;
    if (u_hex > 0.5) r *= 0.866025 / cos(mod(a, 1.0471976) - 0.5235988);
    vec4 c = at0(p + r * vec2(cos(a), sin(a)));
    float w = 1.0 + u_gain * 8.0 * smoothstep(u_thresh, 1.0, luma(unpre(c)));
    acc += c * w; ws += w;
  }
  o = acc / ws;
}`);

export const DIRECTIONAL_BLUR = fs(`uniform vec2 u_dir; uniform float u_length;
void main() {
  vec2 p = gl_FragCoord.xy;
  if (u_length < 0.5) { o = at(p); return; }
  vec4 acc = vec4(0.0);
  for (float i = 0.0; i < 48.0; i++) acc += at0(p + u_dir * u_length * (i / 47.0 - 0.5));
  o = acc / 48.0;
}`);

export const SHARPEN = fs(`uniform float u_amount;
void main() {
  vec2 p = gl_FragCoord.xy; vec4 c = at(p);
  vec4 lap = 4.0 * c - at(p + vec2(1, 0)) - at(p - vec2(1, 0)) - at(p + vec2(0, 1)) - at(p - vec2(0, 1));
  vec4 r = c + lap * u_amount / 100.0;
  o = vec4(clamp(r.rgb, 0.0, c.a), c.a);
}`);

/** u_aux = blurred copy. */
export const UNSHARP = fs(`uniform sampler2D u_aux; uniform float u_amount, u_threshold;
void main() {
  vec2 p = gl_FragCoord.xy; vec4 c = at(p), b = sampleOf(u_aux, p);
  vec4 d = c - b;
  float m = max(abs(d.r), max(abs(d.g), abs(d.b))) * 255.0;
  vec4 r = m < u_threshold ? c : c + d * u_amount / 100.0;
  o = vec4(clamp(r.rgb, 0.0, c.a), c.a);
}`);

// ---- colour ------------------------------------------------------------------------------------

/** Wraps a colour transform of 'rgb' (unpremultiplied); alpha is kept. */
const color = (decl: string, body: string) =>
  fs(`${decl}
void main() { vec2 p = gl_FragCoord.xy; vec4 c = at(p); if (c.a <= 0.0) { o = vec4(0.0); return; } vec3 rgb = unpre(c);
${body}
o = pre(rgb, c.a); }`);

export const LUMETRI = color(
  `uniform float u_exposure, u_contrast, u_highlights, u_shadows, u_whites, u_blacks, u_temperature, u_tint, u_saturation, u_vibrance, u_vignette;`,
  `rgb *= exp2(u_exposure);
  float t = u_temperature / 100.0, ti = u_tint / 100.0;
  rgb *= vec3(1.0 + 0.25 * t + 0.08 * ti, 1.0 - 0.2 * ti, 1.0 - 0.25 * t + 0.08 * ti);
  float l = luma(rgb);
  rgb *= 1.0 + u_shadows / 100.0 * 0.7 * (1.0 - smoothstep(0.0, 0.55, l));
  rgb *= 1.0 + u_highlights / 100.0 * 0.4 * smoothstep(0.45, 1.0, l);
  float bl = -u_blacks / 100.0 * 0.2, wh = 1.0 - u_whites / 100.0 * 0.2;
  rgb = (rgb - bl) / max(wh - bl, 0.05);
  rgb = (rgb - 0.5) * (1.0 + u_contrast / 100.0) + 0.5;
  float g = luma(rgb), sat = max(rgb.r, max(rgb.g, rgb.b)) - min(rgb.r, min(rgb.g, rgb.b));
  rgb = mix(vec3(g), rgb, u_saturation / 100.0 * (1.0 + u_vibrance / 100.0 * (1.0 - clamp(sat, 0.0, 1.0))));
  vec2 d = (p - frameCentre()) / (0.5 * u_frame.zw);
  rgb *= 1.0 - u_vignette / 100.0 * smoothstep(0.45, 1.45, length(d));`,
);

/** u_lut: 256×1 curve; u_mask selects the channels it applies to. */
export const LUT = color(
  `uniform sampler2D u_lut; uniform vec3 u_mask;`,
  `vec3 m = vec3(texture(u_lut, vec2(clamp(rgb.r, 0.0, 1.0) * 255.0 / 256.0 + 0.5 / 256.0, 0.5)).r,
    texture(u_lut, vec2(clamp(rgb.g, 0.0, 1.0) * 255.0 / 256.0 + 0.5 / 256.0, 0.5)).r,
    texture(u_lut, vec2(clamp(rgb.b, 0.0, 1.0) * 255.0 / 256.0 + 0.5 / 256.0, 0.5)).r);
  rgb = mix(rgb, m, u_mask);`,
);

export const HUE_SAT = color(
  `uniform float u_hue, u_saturation, u_lightness, u_colorize, u_colorizeHue, u_colorizeSaturation;`,
  `vec3 h = rgb2hsl(clamp(rgb, 0.0, 1.0));
  if (u_colorize > 0.5) { h.x = u_colorizeHue / 360.0; h.y = u_colorizeSaturation / 100.0; }
  else {
    h.x = fract(h.x + u_hue / 360.0);
    float s = u_saturation / 100.0;
    h.y = s < 0.0 ? h.y * (1.0 + s) : h.y + (1.0 - h.y) * s * h.y;
  }
  float L = u_lightness / 100.0;
  h.z = L < 0.0 ? h.z * (1.0 + L) : h.z + (1.0 - h.z) * L;
  rgb = hsl2rgb(h);`,
);

export const TINT = color(`uniform vec3 u_black, u_white; uniform float u_amount;`, `rgb = mix(rgb, mix(u_black, u_white, luma(rgb)), u_amount / 100.0);`);

export const TRITONE = color(
  `uniform vec3 u_hi, u_mid, u_lo; uniform float u_blend;`,
  `float g = clamp(luma(rgb), 0.0, 1.0);
  vec3 t = g < 0.5 ? mix(u_lo, u_mid, g * 2.0) : mix(u_mid, u_hi, g * 2.0 - 1.0);
  rgb = mix(t, rgb, u_blend / 100.0);`,
);

export const BRIGHT_CONTRAST = color(
  `uniform float u_brightness, u_contrast;`,
  `rgb += u_brightness / 255.0;
  rgb = (rgb - 0.5) * (u_contrast >= 0.0 ? 1.0 + u_contrast / 50.0 : 1.0 + u_contrast / 100.0) + 0.5;`,
);

export const POSTERIZE = color(`uniform float u_levels;`, `rgb = clamp(floor(clamp(rgb, 0.0, 1.0) * u_levels) / (u_levels - 1.0), 0.0, 1.0);`);

export const FILL = fs(`uniform vec3 u_color; uniform float u_opacity;
void main() { vec4 c = at(gl_FragCoord.xy); o = mix(c, vec4(u_color * c.a, c.a), u_opacity); }`);

// ---- distort -----------------------------------------------------------------------------------

/** u_inv: inverse 2×2 (column-major in a vec4), around u_anchor, moved to u_pos. */
export const AFFINE = fs(`uniform vec4 u_inv; uniform vec2 u_anchor, u_pos; uniform float u_opacity;
void main() {
  vec2 d = gl_FragCoord.xy - u_pos;
  vec2 q = u_anchor + mat2(u_inv.xy, u_inv.zw) * d;
  o = at0(q) * u_opacity;
}`);

export const TURBULENT = fs(`uniform float u_amount, u_size, u_complexity, u_evolution;
void main() {
  vec2 p = gl_FragCoord.xy, n = p / u_size + u_evolution;
  vec2 d = vec2(fbm(n, u_complexity), fbm(n + vec2(5.2, 1.3), u_complexity)) - 0.5;
  o = at(p + d * 2.0 * u_amount);
}`);

/** u_map: the displacement source; u_chan*: channel weights (r, g, b or luma). */
export const DISPLACE = fs(`uniform sampler2D u_map; uniform vec3 u_chanX, u_chanY; uniform vec2 u_max;
void main() {
  vec2 p = gl_FragCoord.xy;
  vec3 m = unpre(sampleOf(u_map, p));
  vec2 v = vec2(dot(m, u_chanX), dot(m, u_chanY)) - 0.5;
  o = at(p + vec2(v.x * 2.0 * u_max.x, -v.y * 2.0 * u_max.y));
}`);

export const OPTICS = fs(`uniform float u_fov, u_reverse;
void main() {
  vec2 p = gl_FragCoord.xy, c = frameCentre(), d = p - c;
  float R = 0.5 * length(u_frame.zw), rn = length(d) / R;
  if (u_fov < 0.001 || rn < 1e-5) { o = at0(p); return; }
  float h = u_fov * 0.5;
  float sr = u_reverse > 0.5 ? atan(rn * tan(h)) / h : tan(rn * h) / tan(h);
  o = at0(c + d / rn * sr);
}`);

/** u_h: homography from output pixels to source pixels (column-major mat3). */
export const HOMOGRAPHY = fs(`uniform mat3 u_h;
void main() {
  vec3 q = u_h * vec3(gl_FragCoord.xy, 1.0);
  vec2 s = q.xy / q.z;
  bool inFrame = q.z > 0.0 && s.x >= u_frame.x && s.y >= u_frame.y && s.x <= u_frame.x + u_frame.z && s.y <= u_frame.y + u_frame.w;
  o = inFrame ? at(s) : vec4(0.0);
}`);

// ---- generate ----------------------------------------------------------------------------------

const insideFrame = `float inFrame(vec2 p) { return step(u_frame.x, p.x) * step(u_frame.y, p.y) * step(p.x, u_frame.x + u_frame.z) * step(p.y, u_frame.y + u_frame.w); }`;

export const RAMP = fs(`${insideFrame}
uniform vec2 u_start, u_end; uniform vec3 u_c0, u_c1; uniform float u_radial, u_blend;
void main() {
  vec2 p = gl_FragCoord.xy, e = u_end - u_start;
  float t = u_radial > 0.5 ? length(p - u_start) / max(length(e), 1e-3) : dot(p - u_start, e) / max(dot(e, e), 1e-3);
  float a = inFrame(p);
  vec4 g = vec4(mix(u_c0, u_c1, clamp(t, 0.0, 1.0)) * a, a);
  o = mix(g, at(p), u_blend / 100.0);
}`);

export const FOUR_COLOR = fs(`${insideFrame}
uniform vec2 u_p1, u_p2, u_p3, u_p4; uniform vec3 u_c1, u_c2, u_c3, u_c4; uniform float u_blend, u_opacity;
void main() {
  vec2 p = gl_FragCoord.xy; float k = u_blend / 50.0, diag = length(u_frame.zw);
  float w1 = pow(1.0 / (length(p - u_p1) / diag + 1e-3), k), w2 = pow(1.0 / (length(p - u_p2) / diag + 1e-3), k);
  float w3 = pow(1.0 / (length(p - u_p3) / diag + 1e-3), k), w4 = pow(1.0 / (length(p - u_p4) / diag + 1e-3), k);
  vec3 col = (u_c1 * w1 + u_c2 * w2 + u_c3 * w3 + u_c4 * w4) / (w1 + w2 + w3 + w4);
  float a = inFrame(p);
  o = mix(at(p), vec4(col * a, a), u_opacity / 100.0);
}`);

export const GRID = fs(`${insideFrame}
uniform float u_size, u_border, u_opacity, u_invert; uniform vec3 u_color;
void main() {
  vec2 p = gl_FragCoord.xy, q = mod(p - frameCentre(), u_size);
  vec2 dist = min(q, u_size - q);
  float line = 1.0 - smoothstep(u_border * 0.5 - 0.5, u_border * 0.5 + 0.5, min(dist.x, dist.y));
  if (u_invert > 0.5) line = 1.0 - line;
  line *= inFrame(p) * u_opacity / 100.0;
  vec4 c = at(p);
  o = vec4(c.rgb * (1.0 - line) + u_color * line, c.a + (1.0 - c.a) * line);
}`);

/** Glow at the source, a ring, and ghosts along the line through the frame centre (added). */
export const LENS_FLARE = fs(`uniform vec2 u_centre; uniform float u_brightness, u_lens;
vec3 ghost(vec2 p, vec2 at, float r, vec3 col) { float d = length(p - at) / r; return col * smoothstep(1.0, 0.75, d) * 0.12; }
void main() {
  vec2 p = gl_FragCoord.xy, c = frameCentre(), axis = c - u_centre;
  float diag = length(u_frame.zw), d = length(p - u_centre) / diag;
  vec3 f = vec3(1.0, 0.95, 0.85) * (exp(-d * d * 900.0) * 1.5 + exp(-d * 18.0) * 0.35);
  float ring = exp(-pow((d - (u_lens > 1.5 ? 0.09 : 0.14)) * 60.0, 2.0));
  f += vec3(0.6, 0.8, 1.0) * ring * 0.25;
  float rays = pow(abs(sin(atan(p.y - u_centre.y, p.x - u_centre.x) * (u_lens > 0.5 ? 6.0 : 4.0))), 30.0) * exp(-d * 9.0);
  f += vec3(1.0, 0.9, 0.7) * rays * 0.4;
  f += ghost(p, u_centre + axis * 0.5, diag * 0.03, vec3(0.4, 1.0, 0.5));
  f += ghost(p, u_centre + axis * 1.2, diag * 0.06, vec3(1.0, 0.5, 0.9));
  f += ghost(p, u_centre + axis * 1.6, diag * 0.02, vec3(0.5, 0.7, 1.0));
  f += ghost(p, u_centre + axis * 2.1, diag * 0.09, vec3(1.0, 0.8, 0.4));
  f *= u_brightness / 100.0;
  vec4 s = at(p);
  o = vec4(min(s.rgb + f, vec3(1.0)), max(s.a, clamp(luma(f), 0.0, 1.0)));
}`);

/** Dilated alpha → outline, behind the layer or alone. */
export const STROKE = fs(`uniform vec3 u_color; uniform float u_size, u_opacity, u_only;
void main() {
  vec2 p = gl_FragCoord.xy; vec4 c = at(p);
  float m = c.a;
  for (float r = 1.0; r <= 3.0; r++)
    for (float i = 0.0; i < 24.0; i++) {
      float a = i * 0.2617994;
      m = max(m, at0(p + vec2(cos(a), sin(a)) * u_size * r / 3.0).a);
    }
  vec4 s = vec4(u_color, 1.0) * m * u_opacity / 100.0;
  o = u_only > 0.5 ? s * (1.0 - c.a) : c + s * (1.0 - c.a);
}`);

// ---- stylize -----------------------------------------------------------------------------------

export const BRIGHT_PASS = fs(`uniform float u_threshold, u_useColor; uniform vec3 u_color;
void main() {
  vec4 c = at(gl_FragCoord.xy); vec3 rgb = unpre(c);
  float k = clamp((luma(rgb) - u_threshold) / max(1.0 - u_threshold, 1e-3), 0.0, 1.0) * c.a;
  o = u_useColor > 0.5 ? vec4(u_color, 1.0) * k : vec4(rgb, 1.0) * k;
}`);

/** u_aux added onto the source with u_amount. */
export const ADD = fs(`uniform sampler2D u_aux; uniform float u_amount;
void main() { vec2 p = gl_FragCoord.xy; vec4 c = at(p), g = sampleOf(u_aux, p) * u_amount; o = vec4(min(c.rgb + g.rgb, vec3(1.0)), clamp(c.a + g.a, 0.0, 1.0)); }`);

/** Shadow source: the layer's alpha moved by u_offset, coloured. */
export const SHADOW_SHAPE = fs(`uniform vec2 u_offset; uniform vec3 u_color; uniform float u_opacity;
void main() { o = vec4(u_color, 1.0) * at0(gl_FragCoord.xy - u_offset).a * u_opacity; }`);

/** u_aux: original layer, drawn over the (blurred) shadow in u_src unless shadow only. */
export const SHADOW_COMBINE = fs(`uniform sampler2D u_aux; uniform float u_only;
void main() { vec2 p = gl_FragCoord.xy; vec4 s = at(p), c = sampleOf(u_aux, p); o = u_only > 0.5 ? s : c + s * (1.0 - c.a); }`);

export const MOTION_TILE = fs(`uniform vec2 u_centre, u_tile; uniform float u_mirror;
void main() {
  vec2 q = (gl_FragCoord.xy - u_centre) / u_tile + 0.5;
  vec2 f = u_mirror > 0.5 ? 1.0 - abs(mod(q, 2.0) - 1.0) : fract(q);
  o = at(u_centre + (f - 0.5) * u_frame.zw);
}`);

/** u_aux: blurred alpha; noise-thresholded so the edge eats in irregularly. */
export const ROUGHEN = fs(`uniform sampler2D u_aux; uniform float u_sharpness, u_scale, u_evolution;
void main() {
  vec2 p = gl_FragCoord.xy; vec4 c = at(p);
  float n = fbm(p / u_scale + u_evolution, 4.0);
  float a = clamp((sampleOf(u_aux, p).a - (0.25 + 0.6 * n)) * u_sharpness * 4.0 + 0.5, 0.0, 1.0);
  o = c * a;
}`);

export const FIND_EDGES = fs(`uniform float u_invert, u_blend;
vec3 s(vec2 p) { vec4 c = at0(p); return c.rgb + (1.0 - c.a); }
void main() {
  vec2 p = gl_FragCoord.xy; vec4 c = at(p);
  vec3 gx = -s(p + vec2(-1, 1)) - 2.0 * s(p + vec2(-1, 0)) - s(p + vec2(-1, -1)) + s(p + vec2(1, 1)) + 2.0 * s(p + vec2(1, 0)) + s(p + vec2(1, -1));
  vec3 gy = -s(p + vec2(-1, -1)) - 2.0 * s(p + vec2(0, -1)) - s(p + vec2(1, -1)) + s(p + vec2(-1, 1)) + 2.0 * s(p + vec2(0, 1)) + s(p + vec2(1, 1));
  vec3 e = clamp(sqrt(gx * gx + gy * gy) * 0.5, 0.0, 1.0);
  vec3 r = u_invert > 0.5 ? e : 1.0 - e;
  o = pre(mix(r, unpre(c), u_blend / 100.0), c.a);
}`);

// ---- perspective -------------------------------------------------------------------------------

/** u_aux: blurred alpha (the bevel's height). */
export const BEVEL = fs(`uniform sampler2D u_aux; uniform vec2 u_light; uniform vec3 u_lightColor; uniform float u_intensity, u_thickness;
void main() {
  vec2 p = gl_FragCoord.xy; vec4 c = at(p);
  float hx = sampleOf(u_aux, p + vec2(1, 0)).a - sampleOf(u_aux, p - vec2(1, 0)).a;
  float hy = sampleOf(u_aux, p + vec2(0, 1)).a - sampleOf(u_aux, p - vec2(0, 1)).a;
  vec3 n = normalize(vec3(-hx, -hy, 2.0 / max(u_thickness, 0.5)));
  float shade = dot(n.xy, u_light) * u_intensity * 2.0;
  vec3 rgb = unpre(c) + u_lightColor * max(shade, 0.0) + vec3(min(shade, 0.0));
  o = pre(rgb, c.a);
}`);

export const SPHERE = fs(`uniform vec2 u_centre; uniform float u_radius, u_rotX, u_rotY, u_light;
void main() {
  vec2 d = (gl_FragCoord.xy - u_centre) / u_radius;
  float r2 = dot(d, d);
  if (r2 > 1.0) { o = vec4(0.0); return; }
  vec3 n = vec3(d, sqrt(1.0 - r2));
  float cx = cos(u_rotX), sx = sin(u_rotX), cy = cos(u_rotY), sy = sin(u_rotY);
  vec3 v = vec3(n.x, n.y * cx - n.z * sx, n.y * sx + n.z * cx);
  v = vec3(v.x * cy + v.z * sy, v.y, -v.x * sy + v.z * cy);
  vec2 uv = vec2(atan(v.x, v.z) / 6.2831853 + 0.5, asin(clamp(v.y, -1.0, 1.0)) / 3.1415927 + 0.5);
  vec4 c = at(u_frame.xy + uv * u_frame.zw);
  float lit = max(dot(n, normalize(vec3(-0.5, 0.6, 0.7))), 0.0);
  float shade = mix(1.0, 0.25 + 0.95 * lit, u_light);
  o = vec4(c.rgb * shade, c.a);
}`);

// ---- keying ------------------------------------------------------------------------------------

export const LINEAR_KEY = fs(`uniform vec3 u_key, u_dominant; uniform float u_tolerance, u_softness, u_spill;
void main() {
  vec4 c = at(gl_FragCoord.xy); vec3 rgb = unpre(c);
  float d = length(rgb - u_key) / 1.7320508;
  float a = smoothstep(u_tolerance, u_tolerance + u_softness + 1e-4, d);
  // Spill: pull the key's dominant channel down towards the strongest other channel.
  float dom = dot(rgb, u_dominant);
  float others = max(max(rgb.r * (1.0 - u_dominant.r), rgb.g * (1.0 - u_dominant.g)), rgb.b * (1.0 - u_dominant.b));
  rgb -= u_dominant * max(dom - others, 0.0) * u_spill;
  o = pre(rgb, c.a * a);
}`);

export const COLOR_RANGE = fs(`uniform float u_hue, u_hueRange, u_minSat, u_minL, u_maxL, u_softness;
void main() {
  vec4 c = at(gl_FragCoord.xy); vec3 h = rgb2hsl(unpre(c));
  float dh = abs(fract(h.x - u_hue + 0.5) - 0.5) * 2.0;
  float s = u_softness + 1e-4;
  float inside = (1.0 - smoothstep(u_hueRange, u_hueRange + s, dh)) * smoothstep(u_minSat - s, u_minSat, h.y) * smoothstep(u_minL - s, u_minL, h.z) * (1.0 - smoothstep(u_maxL, u_maxL + s, h.z));
  o = c * (1.0 - inside);
}`);

// ---- transitions (alpha masks; completion 0 = fully visible, 1 = gone) -------------------------

export const LINEAR_WIPE = fs(`uniform vec2 u_dir; uniform float u_completion, u_feather;
void main() {
  vec2 p = gl_FragCoord.xy; float along = dot(p - frameCentre(), u_dir);
  float e = 0.5 * (abs(u_frame.z * u_dir.x) + abs(u_frame.w * u_dir.y));
  float edge = mix(-e - u_feather, e, u_completion);
  o = at(p) * (u_feather > 0.0 ? smoothstep(edge, edge + u_feather, along) : step(edge, along));
}`);

export const RADIAL_WIPE = fs(`uniform vec2 u_centre; uniform float u_completion, u_start, u_mode, u_feather;
void main() {
  vec2 d = gl_FragCoord.xy - u_centre;
  float a = fract((atan(d.x, d.y) - u_start) / 6.2831853);
  if (u_mode > 1.5) a = min(a, 1.0 - a) * 2.0; else if (u_mode > 0.5) a = 1.0 - a;
  float f = u_feather / 360.0, edge = mix(-f, 1.0, u_completion);
  o = at(gl_FragCoord.xy) * (f > 0.0 ? smoothstep(edge, edge + f, a) : step(edge, a));
}`);

export const BLINDS = fs(`uniform vec2 u_dir; uniform float u_completion, u_width, u_feather;
void main() {
  vec2 p = gl_FragCoord.xy; float ph = fract(dot(p - frameCentre(), u_dir) / u_width);
  float f = u_feather / u_width, edge = mix(-f, 1.0, u_completion);
  o = at(p) * (f > 0.0 ? smoothstep(edge, edge + f, ph) : step(edge, ph));
}`);

export const BLOCKS = fs(`uniform vec2 u_block; uniform float u_completion, u_feather;
void main() {
  vec2 p = gl_FragCoord.xy; float r = hash(floor((p - u_frame.xy) / u_block) + 0.5);
  float f = u_feather * 0.5, edge = mix(-f, 1.0, u_completion);
  o = at(p) * (f > 0.0 ? smoothstep(edge, edge + f, r) : step(edge, r));
}`);

export const GRADIENT_WIPE = fs(`uniform float u_completion, u_softness, u_mode, u_invert;
void main() {
  vec2 p = gl_FragCoord.xy; vec4 c = at(p);
  vec2 q = (p - u_frame.xy) / u_frame.zw;
  float g = u_mode < 0.5 ? luma(unpre(c)) : u_mode < 1.5 ? q.x : u_mode < 2.5 ? 1.0 - q.y : u_mode < 3.5 ? length(q - 0.5) * 1.41421 : fbm(q * 6.0, 4.0);
  if (u_invert > 0.5) g = 1.0 - g;
  float s = u_softness, edge = mix(-s, 1.0, u_completion);
  o = c * (s > 0.0 ? smoothstep(edge, edge + s, g) : step(edge, g));
}`);

// ---- time --------------------------------------------------------------------------------------

/** Combine an echo (u_aux × u_weight) into the accumulation u_src with operator u_op. */
export const ECHO = fs(`uniform sampler2D u_aux; uniform float u_weight, u_op;
void main() {
  vec2 p = gl_FragCoord.xy; vec4 a = at(p), e = sampleOf(u_aux, p) * u_weight;
  if (u_op < 0.5) o = min(a + e, vec4(1.0));
  else if (u_op < 1.5) o = max(a, e);
  else if (u_op < 2.5) o = min(a, e);
  else if (u_op < 3.5) o = a + e - a * e;
  else if (u_op < 4.5) o = a + e * (1.0 - a.a);
  else o = e + a * (1.0 - e.a);
}`);

export const SCALE = fs(`uniform float u_k; void main() { o = at(gl_FragCoord.xy) * u_k; }`);

// ---- filters (looks) ---------------------------------------------------------------------------

/** u_aux: a blurred copy (soft focus, glow, sharpen). u_unit: px per 1080p px. */
export const LOOK = fs(`uniform sampler2D u_aux;
uniform float u_intensity, u_unit, u_time;
uniform float u_exposure, u_contrast, u_saturation, u_temperature, u_tint, u_fade, u_mono, u_tealOrange, u_vignette, u_grain;
uniform float u_blur, u_glow, u_sharpen, u_chromatic, u_vhs, u_glitch, u_oldFilm;
uniform vec4 u_shadowsTint, u_highlightsTint; uniform vec3 u_monoMix;
void main() {
  vec2 p = gl_FragCoord.xy; vec4 c0 = at(p);
  // Sampling distortions: VHS line wobble, glitch block shifts, chromatic fringes.
  vec2 off = vec2(0.0);
  if (u_vhs > 0.0) off.x += (vnoise(vec2(p.y / (3.0 * u_unit), u_time * 6.0)) - 0.5) * 8.0 * u_unit * u_vhs;
  float split = u_chromatic * u_unit;
  if (u_glitch > 0.0) {
    vec2 cell = floor(p / (vec2(140.0, 22.0) * u_unit));
    float r = hash(cell + floor(u_time * 9.0));
    if (r > 1.0 - 0.18 * u_glitch) { off.x += (hash(cell * 1.7 + floor(u_time * 9.0)) - 0.5) * 120.0 * u_unit * u_glitch; split += 10.0 * u_unit * u_glitch; }
  }
  vec4 cc = at(p + off);
  vec3 rgb = vec3(unpre(at(p + off + vec2(split, 0.0))).r, unpre(cc).g, unpre(at(p + off - vec2(split, 0.0))).b);
  float a = cc.a;
  if (a <= 0.0) { o = c0 * (1.0 - u_intensity); return; }
  vec3 b = unpre(sampleOf(u_aux, p + off));
  rgb = mix(rgb, b, u_blur);
  rgb += max(b - 0.55, 0.0) * u_glow * 2.2;
  rgb += (rgb - b) * u_sharpen * 1.5;
  rgb *= exp2(u_exposure);
  rgb *= vec3(1.0 + 0.22 * u_temperature + 0.06 * u_tint, 1.0 - 0.18 * u_tint, 1.0 - 0.22 * u_temperature + 0.06 * u_tint);
  rgb = (rgb - 0.5) * (1.0 + u_contrast) + 0.5;
  float l = luma(rgb);
  rgb = mix(vec3(l), rgb, u_saturation);
  if (u_tealOrange > 0.0) {
    vec3 to = mix(vec3(0.0, 0.42, 0.48), vec3(1.0, 0.62, 0.35), smoothstep(0.15, 0.85, l));
    rgb = mix(rgb, rgb * 0.55 + to * l * 0.75 + to * 0.12, u_tealOrange * 0.6);
  }
  rgb += (u_shadowsTint.rgb - 0.5) * u_shadowsTint.a * (1.0 - smoothstep(0.0, 0.6, l)) * 0.6;
  rgb += (u_highlightsTint.rgb - 0.5) * u_highlightsTint.a * smoothstep(0.4, 1.0, l) * 0.6;
  rgb = mix(rgb, vec3(dot(rgb, u_monoMix)), u_mono);
  rgb = mix(vec3(u_fade * 0.22), vec3(1.0 - u_fade * 0.12), clamp(rgb, 0.0, 1.0));
  vec2 d = (p - frameCentre()) / (0.5 * u_frame.zw);
  rgb *= 1.0 - u_vignette * 0.65 * smoothstep(0.35, 1.45, length(d));
  rgb += (hash(p + fract(u_time * 7.13) * 91.7) - 0.5) * u_grain * 0.22;
  if (u_vhs > 0.0) rgb *= 1.0 - u_vhs * 0.12 * (0.5 + 0.5 * sin(p.y * 3.1415927 / (1.5 * u_unit)));
  if (u_oldFilm > 0.0) {
    rgb *= 1.0 + (hash(vec2(floor(u_time * 12.0), 3.1)) - 0.5) * 0.18 * u_oldFilm;
    vec2 q = (p - u_frame.xy) / u_frame.zw; float f = floor(u_time * 12.0);
    float sx = hash(vec2(f, 7.7)), scratch = hash(vec2(f, 1.3)) > 0.55 ? 1.0 - smoothstep(0.0, 0.0015, abs(q.x - sx)) : 0.0;
    float dust = step(0.9993, hash(floor(p / (2.0 * u_unit)) + f));
    rgb = mix(rgb, vec3(0.92), scratch * 0.5 * u_oldFilm);
    rgb = mix(rgb, vec3(0.05), dust * u_oldFilm);
  }
  o = mix(c0, pre(rgb, a), u_intensity);
}`);
