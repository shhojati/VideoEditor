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

Object.assign(window, { bench, score, normalize });
log(`ready · webgpu=${!!navigator.gpu} · crossOriginIsolated=${crossOriginIsolated}`);
