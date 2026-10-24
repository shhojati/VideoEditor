// Persian speech-to-text accuracy bench: the 12 Common Voice clips in public/spike-data, mixed the
// way the app does (or resampled by the browser), cut with planWindows and transcribed with the
// app's options; scored as WER/CER against ref.json. Run variants with window.bench({...}).
import { BinAccumulator, STT_RATE } from '../src/engine/stt/audio16k';
import { planWindows } from '../src/engine/stt/windows';
import type { BenchRequest } from './stt-bench.worker';

export interface BenchConfig {
  model?: 'tiny' | 'base' | 'small' | 'large-v3-turbo';
  device?: 'webgpu' | 'wasm';
  encoder?: 'fp32' | 'fp16' | 'q8' | 'q4';
  decoder?: 'q4' | 'q8' | 'fp16' | 'fp32';
  /** `box`: the app's 48 kHz -> 16 kHz averaging; `browser`: decodeAudioData at 16 kHz. */
  resample?: 'box' | 'browser';
  words?: boolean;
}

const GAP = 0.6;
const out = document.getElementById('out')!;
const log = (s: string) => (out.textContent += s + '\n');

async function clips(rate: number) {
  const ac = new AudioContext({ sampleRate: rate });
  const bufs: AudioBuffer[] = [];
  for (let i = 0; i < 12; i++) bufs.push(await ac.decodeAudioData(await (await fetch(`/spike-data/s${i}.mp3`)).arrayBuffer()));
  await ac.close();
  return bufs;
}

/** Concatenate with gaps, mono, at `rate`. */
function join(bufs: AudioBuffer[], rate: number) {
  const gap = Math.round(GAP * rate);
  const pcm = new Float32Array(bufs.reduce((n, b) => n + b.length + gap, gap));
  let o = gap;
  for (const b of bufs) {
    pcm.set(b.getChannelData(0), o);
    o += b.length + gap;
  }
  return pcm;
}

async function audio16k(resample: 'box' | 'browser') {
  if (resample === 'browser') return join(await clips(STT_RATE), STT_RATE);
  const src = join(await clips(48_000), 48_000);
  const acc = new BinAccumulator(0, Math.ceil((src.length / 48_000) * STT_RATE) + 1);
  for (let i = 0; i < src.length; i += 1024) {
    const chunk = src.subarray(i, i + 1024);
    acc.push([chunk], (k) => ((i + k) / 48_000) * STT_RATE);
  }
  const mix = new Float32Array(Math.ceil((src.length / 48_000) * STT_RATE));
  acc.addInto(mix, 1);
  return mix;
}

// Built from code points so no invisible characters live in this file.
const range = (a: number, b: number) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`;
const DIACRITICS = new RegExp(`[${range(0x064b, 0x0652)}${String.fromCharCode(0x0670)}]`, 'g');
const ZWNJ = new RegExp(String.fromCharCode(0x200c), 'g');
const PUNCT = /[.,!?؟،؛:;"'«»()\-–—|]/g;

export function normalize(s: string) {
  return s
    .replace(new RegExp(String.fromCharCode(0x064a), 'g'), String.fromCharCode(0x06cc))
    .replace(new RegExp(String.fromCharCode(0x0643), 'g'), String.fromCharCode(0x06a9))
    .replace(/[أإآ]/g, 'ا')
    .replace(DIACRITICS, '')
    .replace(ZWNJ, ' ')
    .replace(PUNCT, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function distance<T>(a: T[], b: T[]) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

export function score(ref: string, hyp: string) {
  const r = normalize(ref);
  const h = normalize(hyp);
  const rw = r.split(' ');
  const rc = [...r.replace(/ /g, '')];
  return { wer: distance(rw, h.split(' ')) / rw.length, cer: distance(rc, [...h.replace(/ /g, '')]) / rc.length };
}

async function bench(cfg: BenchConfig = {}) {
  const c = { model: 'small', device: navigator.gpu ? 'webgpu' : 'wasm', encoder: 'fp32', decoder: 'q8', resample: 'box', words: true, ...cfg } as Required<BenchConfig>;
  const ref = ((await (await fetch('/spike-data/ref.json')).json()) as string[]).join(' ');
  const pcm = await audio16k(c.resample);
  const windows = planWindows(pcm, STT_RATE);
  const w = new Worker(new URL('./stt-bench.worker.ts', import.meta.url), { type: 'module' });
  const res = await new Promise<{ ok: boolean; texts?: string[]; loadMs?: number; runMs?: number; message?: string }>((resolve) => {
    w.onmessage = (e) => resolve(e.data);
    w.onerror = (e) => resolve({ ok: false, message: e.message || 'worker crashed' });
    w.postMessage({ pcm, windows, model: c.model, device: c.device, encoder: c.encoder, decoder: c.decoder, words: c.words } satisfies BenchRequest);
  });
  w.terminate();
  if (!res.ok) {
    log(`${JSON.stringify(c)} ERROR ${res.message}`);
    return { ...c, error: res.message };
  }
  const text = res.texts!.join(' ');
  const s = score(ref, text);
  const rtf = res.runMs! / 1000 / (pcm.length / STT_RATE);
  log(`${JSON.stringify(c)}  WER ${(s.wer * 100).toFixed(1)}%  CER ${(s.cer * 100).toFixed(1)}%  RTF ${rtf.toFixed(2)}\n  ${text}\n`);
  return { ...c, ...s, rtf, text };
}

/** Audio facts that explain bad transcripts: level, clipping, and whether L/R cancel when mixed. */
function audioStats(buf: AudioBuffer) {
  const ch = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const rms = (x: Float32Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
  let peak = 0;
  let clipped = 0;
  for (const x of ch) for (const v of x) {
    peak = Math.max(peak, Math.abs(v));
    if (Math.abs(v) > 0.99) clipped++;
  }
  let corr: number | null = null;
  if (ch.length >= 2) {
    let lr = 0;
    let ll = 0;
    let rr = 0;
    for (let i = 0; i < ch[0].length; i++) {
      lr += ch[0][i] * ch[1][i];
      ll += ch[0][i] ** 2;
      rr += ch[1][i] ** 2;
    }
    corr = lr / Math.sqrt(ll * rr || 1);
  }
  return { seconds: buf.duration, sampleRate: buf.sampleRate, channels: buf.numberOfChannels, rms: ch.map(rms), peak, clipped, lrCorrelation: corr };
}

function wav16(pcm: Float32Array) {
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o: number, t: string) => [...t].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  out.setUint32(4, 36 + pcm.length * 2, true);
  str(8, 'WAVEfmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, STT_RATE, true);
  out.setUint32(28, STT_RATE * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  str(36, 'data');
  out.setUint32(40, pcm.length * 2, true);
  pcm.forEach((v, i) => out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  return new Uint8Array(out.buffer);
}

/** Transcribe the file picked in #file the way the app would; returns per-window text and stats. */
async function benchFile(cfg: BenchConfig = {}) {
  const c = { model: 'large-v3-turbo', device: navigator.gpu ? 'webgpu' : 'wasm', encoder: 'q4', decoder: 'q4', words: true, ...cfg } as Required<BenchConfig>;
  const file = (document.getElementById('file') as HTMLInputElement).files![0];
  const ac = new AudioContext({ sampleRate: 48_000 });
  const buf = await ac.decodeAudioData(await file.arrayBuffer());
  await ac.close();
  const stats = audioStats(buf);
  // The app's mixdown: channels averaged, 48 kHz -> 16 kHz box filter.
  const acc = new BinAccumulator(0, Math.ceil(buf.duration * STT_RATE) + 1);
  const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  for (let i = 0; i < buf.length; i += 4096) acc.push(chans.map((x) => x.subarray(i, i + 4096)), (k) => ((i + k) / 48_000) * STT_RATE);
  const pcm = new Float32Array(Math.ceil(buf.duration * STT_RATE));
  acc.addInto(pcm, 1);
  const windows = planWindows(pcm, STT_RATE);
  const w = new Worker(new URL('./stt-bench.worker.ts', import.meta.url), { type: 'module' });
  const res = await new Promise<{ ok: boolean; texts?: string[]; runMs?: number; message?: string }>((resolve) => {
    w.onmessage = (e) => resolve(e.data);
    w.onerror = (e) => resolve({ ok: false, message: e.message || 'worker crashed' });
    w.postMessage({ pcm: pcm.slice(), windows, model: c.model, device: c.device, encoder: c.encoder, decoder: c.decoder, words: c.words } satisfies BenchRequest);
  });
  w.terminate();
  const parts = (res.texts ?? []).map((t, i) => `[${(windows[i].start / STT_RATE).toFixed(1)}-${(windows[i].end / STT_RATE).toFixed(1)}] ${t.trim()}`);
  log([`${file.name} ${JSON.stringify(c)} ${JSON.stringify(stats)}`, res.ok ? parts.join('\n') : `ERROR ${res.message}`, ''].join('\n'));
  let bin = '';
  const bytes = wav16(pcm);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { ...c, stats, windows: windows.length, rtf: res.runMs ? res.runMs / 1000 / buf.duration : undefined, error: res.message, parts, wav: btoa(bin) };
}

Object.assign(window, { bench, benchFile, score, normalize });
log(`ready · webgpu=${!!navigator.gpu} · crossOriginIsolated=${crossOriginIsolated}`);
