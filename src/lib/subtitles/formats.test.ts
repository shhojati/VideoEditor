import { describe, expect, it } from 'vitest';
import { cleanCueText, formatSrt, formatVtt, parseSrt, parseSubtitles, parseVtt } from './formats';

const RLM = '\u200F';
const RLE = '\u202B';
const PDF = '\u202C';

describe('parseSrt', () => {
  it('parses a normal file with BOM, CRLF and Persian text', () => {
    const srt = '\uFEFF1\r\n00:00:01,000 --> 00:00:02,500\r\nسلام دنیا،\r\nخوش آمدید.\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nآیا آماده\u200Cاید؟\r\n';
    expect(parseSrt(srt)).toEqual({
      cues: [
        { start: 1, end: 2.5, text: 'سلام دنیا،\nخوش آمدید.' },
        { start: 3, end: 4, text: 'آیا آماده\u200Cاید؟' },
      ],
      skipped: 0,
    });
  });

  it('removes RTL marks/embeddings that editors add, but keeps ZWNJ', () => {
    const srt = `1\n00:00:01,000 --> 00:00:02,000\n${RLM}${RLE}می\u200Cخواهم بروم.${PDF}${RLM}\n`;
    expect(parseSrt(srt).cues[0].text).toBe('می\u200Cخواهم بروم.');
  });

  it('is lenient: missing index, dot millis, short millis, extra blank lines, mm:ss', () => {
    const srt = '\n\n00:01.5 --> 00:02.25\nno index\n\n\n\n7\n00:00:03.000 --> 00:00:04.000\ndot millis\n';
    expect(parseSrt(srt).cues).toEqual([
      { start: 1.5, end: 2.25, text: 'no index' },
      { start: 3, end: 4, text: 'dot millis' },
    ]);
  });

  it('strips formatting tags and ASS overrides', () => {
    expect(cleanCueText('{\\an8}<i>Hello</i> <font color="#fff">world</font> &amp; co')).toBe('Hello world & co');
  });

  it('skips malformed blocks and counts them', () => {
    const srt = '1\n00:00:05,000 --> 00:00:04,000\nends before it starts\n\n2\nnot a timing line\ntext\n\n3\n00:00:06,000 --> 00:00:07,000\n\n4\n00:00:08,000 --> 00:00:09,000\nok\n';
    expect(parseSrt(srt)).toEqual({ cues: [{ start: 8, end: 9, text: 'ok' }], skipped: 3 });
  });

  it('sorts cues by start time', () => {
    const srt = '1\n00:00:05,000 --> 00:00:06,000\nB\n\n2\n00:00:01,000 --> 00:00:02,000\nA\n';
    expect(parseSrt(srt).cues.map((c) => c.text)).toEqual(['A', 'B']);
  });
});

describe('parseVtt', () => {
  it('handles header, notes, styles, identifiers and cue settings', () => {
    const vtt = `WEBVTT - title

NOTE this is a comment

STYLE
::cue { color: red }

intro
00:00:01.000 --> 00:00:02.000 align:start position:10%
<v Ali>سلام</v>

00:02.500 --> 00:03.000
&lt;3
`;
    expect(parseVtt(vtt).cues).toEqual([
      { start: 1, end: 2, text: 'سلام' },
      { start: 2.5, end: 3, text: '<3' },
    ]);
  });

  it('format detection by name or header', () => {
    expect(parseSubtitles('a.srt', 'WEBVTT\n\n00:01.000 --> 00:02.000\nx').cues).toHaveLength(1);
    expect(parseSubtitles('a.vtt', '00:01.000 --> 00:02.000\nx').cues).toHaveLength(1);
  });
});

describe('formatSrt / formatVtt', () => {
  const cues = [
    { start: 0.5, end: 2, text: '۲۰ درصد\nخط دوم' },
    { start: 3661.2345, end: 3662, text: 'Hi' },
  ];

  it('writes CRLF SRT with padded times', () => {
    expect(formatSrt(cues)).toBe(
      '1\r\n00:00:00,500 --> 00:00:02,000\r\n۲۰ درصد\r\nخط دوم\r\n\r\n2\r\n01:01:01,235 --> 01:01:02,000\r\nHi\r\n',
    );
  });

  it('prefixes every line with RLM for RTL tracks, and round-trips cleanly', () => {
    const out = formatSrt(cues, { rtl: true });
    expect(out).toContain(`${RLM}۲۰ درصد\r\n${RLM}خط دوم`);
    expect(parseSrt(out).cues.map((c) => c.text)).toEqual(cues.map((c) => c.text));
  });

  it('writes escaped VTT that parses back', () => {
    const out = formatVtt([{ start: 1, end: 2, text: 'a < b & c' }]);
    expect(out).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\na &lt; b &amp; c\n');
    expect(parseVtt(out).cues[0].text).toBe('a < b & c');
  });
});
