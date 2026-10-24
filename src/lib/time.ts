/** "m:ss" under an hour, "h:mm:ss" otherwise. Always Latin digits, like every video editor's timecodes. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/**
 * A typed time back to seconds: plain seconds ("12.5"), m:ss, h:mm:ss (seconds may have decimals)
 * or the transport's hh:mm:ss:ff at `fps`. Persian digits are accepted. Null when it is not a time.
 */
export function parseTimecode(text: string, fps: number): number | null {
  const s = text.trim().replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)).replace(/[٫,]/g, '.');
  if (!s) return null;
  const parts = s.split(':');
  if (parts.length > 4 || parts.some((x) => !/^\d+(\.\d+)?$/.test(x))) return null;
  const n = parts.map(Number);
  const frames = parts.length === 4 ? n.pop()! / fps : 0;
  // The rest is h, m, s from the right.
  return n.reverse().reduce((sum, v, i) => sum + v * 60 ** i, 0) + frames;
}
