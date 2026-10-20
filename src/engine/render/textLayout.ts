// Line breaking shared by text clips and subtitles. Breaks only at spaces, never inside a word:
// breaking inside a Persian word would also break its letter joining (ZWNJ, U+200C, is not a break point).

const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LTR_CHAR = /[A-Za-z\u00C0-\u024F]/;

/** Direction of the first strong character (the Unicode "first strong" rule); LTR if none. */
export function detectRtl(text: string): boolean {
  for (const ch of text) {
    if (RTL_CHAR.test(ch)) return true;
    if (LTR_CHAR.test(ch)) return false;
  }
  return false;
}

/**
 * Greedy word wrap of each paragraph to `maxWidth` (in the units of `measure`). A single word wider
 * than the line stays whole on its own line. Collapses runs of spaces.
 */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/ +/).filter(Boolean);
    if (!words.length) {
      out.push('');
      continue;
    }
    let line = words[0];
    for (const word of words.slice(1)) {
      const candidate = `${line} ${word}`;
      if (measure(candidate) <= maxWidth) line = candidate;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}
