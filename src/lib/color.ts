// '#rrggbb' and '#rrggbbaa' colours: the alpha byte split off and put back.

/** '#rrggbbaa' → '#rrggbb' + alpha 0..1 ('#rrggbb' and other notations: alpha 1). */
export function splitAlpha(c: string): { rgb: string; a: number } {
  const m = /^(#[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c);
  if (!m) return { rgb: c, a: 1 };
  return { rgb: m[1].toLowerCase(), a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
}

/** '#rrggbb' with alpha 0..1; fully opaque stays '#rrggbb'. */
export function withAlpha(rgb: string, a: number): string {
  const byte = Math.round(Math.min(1, Math.max(0, a)) * 255);
  return byte === 255 ? rgb : `${rgb}${byte.toString(16).padStart(2, '0')}`;
}
