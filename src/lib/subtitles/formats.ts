// SRT and WebVTT import/export. Lenient on input (BOM, CRLF, missing indices, '.' or ',' millis,
// mm:ss without hours, formatting tags, stray bidi controls), strict and player-friendly on output.

export interface ParsedCue {
  start: number;
  end: number;
  text: string;
}

export interface ParseResult {
  cues: ParsedCue[];
  /** Blocks that could not be understood (malformed timing etc.). */
  skipped: number;
}

const TIME = String.raw`(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})`;
const TIMING = new RegExp(`^\\s*${TIME}\\s*-->\\s*${TIME}`);

/** Bidi embedding/override controls (LRE, RLE, PDF, LRO, RLO) and isolates are dropped; marks only at line ends. */
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g;
const EDGE_MARKS = /^[\u200E\u200F]+|[\u200E\u200F]+$/g;

function seconds(h: string | undefined, m: string, s: string, ms: string) {
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
}

/** Plain text from a cue payload: tags removed, entities decoded, bidi controls cleaned. */
export function cleanCueText(raw: string): string {
  return raw
    .split('\n')
    .map((line) =>
      line
        .replace(/<\/?[a-zA-Z][^>]*>/g, '') // <i>, <b>, <font color=…>, <c.class>, <v Speaker>
        .replace(/\{\\[^}]*\}/g, '') // {\an8} style ASS overrides found in many SRTs
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(BIDI_CONTROLS, '')
        .replace(EDGE_MARKS, '')
        .trim(),
    )
    .filter(Boolean)
    .join('\n');
}

function normalise(input: string) {
  return input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function parseBlocks(blocks: string[]): ParseResult {
  const cues: ParsedCue[] = [];
  let skipped = 0;
  for (const block of blocks) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => TIMING.test(l));
    if (i < 0 || i > 1) {
      if (block.trim()) skipped++;
      continue;
    }
    const m = lines[i].match(TIMING)!;
    const start = seconds(m[1], m[2], m[3], m[4]);
    const end = seconds(m[5], m[6], m[7], m[8]);
    const text = cleanCueText(lines.slice(i + 1).join('\n'));
    if (!(end > start) || !text) {
      skipped++;
      continue;
    }
    cues.push({ start, end, text });
  }
  cues.sort((a, b) => a.start - b.start);
  return { cues, skipped };
}

export function parseSrt(input: string): ParseResult {
  return parseBlocks(normalise(input).split(/\n\s*\n/));
}

export function parseVtt(input: string): ParseResult {
  const text = normalise(input);
  const blocks = text.split(/\n\s*\n/);
  if (/^WEBVTT/.test(blocks[0] ?? '')) blocks.shift();
  // NOTE, STYLE and REGION blocks carry no cues.
  return parseBlocks(blocks.filter((b) => !/^(NOTE|STYLE|REGION)\b/.test(b.trim())));
}

/** Detect the format from the name or content. */
export function parseSubtitles(name: string, input: string): ParseResult {
  return /\.vtt$/i.test(name) || /^\uFEFF?WEBVTT/.test(input) ? parseVtt(input) : parseSrt(input);
}

function stamp(t: number, sep: ',' | '.') {
  const ms = Math.round(Math.max(0, t) * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor(ms / 60_000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

export interface FormatOptions {
  /**
   * Prefix each line with RIGHT-TO-LEFT MARK so players that guess the paragraph direction from the
   * first strong character (VLC, most TVs) keep RTL order for lines starting with digits or Latin.
   */
  rtl?: boolean;
}

const lineMark = (opts: FormatOptions) => (line: string) => (opts.rtl ? `\u200F${line}` : line);

/** SRT with CRLF line endings (what Windows players expect). Add a BOM when saving to a file. */
export function formatSrt(cues: readonly ParsedCue[], opts: FormatOptions = {}): string {
  return cues
    .map((c, i) =>
      [String(i + 1), `${stamp(c.start, ',')} --> ${stamp(c.end, ',')}`, ...c.text.split('\n').map(lineMark(opts))].join(
        '\r\n',
      ),
    )
    .join('\r\n\r\n')
    .concat('\r\n');
}

export function formatVtt(cues: readonly ParsedCue[], opts: FormatOptions = {}): string {
  const body = cues
    .map((c) =>
      [`${stamp(c.start, '.')} --> ${stamp(c.end, '.')}`, ...c.text.split('\n').map(lineMark(opts))]
        .join('\n')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;'),
    )
    .join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

/** UTF-8 with BOM: some Windows players misread BOM-less UTF-8 subtitles as ANSI. */
export function subtitleBlob(text: string) {
  return new Blob(['\uFEFF', text], { type: 'text/plain;charset=utf-8' });
}
