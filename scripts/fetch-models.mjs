// Downloads the ONNX models into public/models/ so speech-to-text, auto reframe and translation run
// fully offline. Run ONCE on a machine with internet access, then copy public/models/ to the target machine.
//
//   node scripts/fetch-models.mjs                 # Whisper tiny + base + small + large-v3-turbo, person detector, translation (8-bit)
//   node scripts/fetch-models.mjs base            # just one Whisper size (tiny, base, small, large-v3-turbo ~1.8 GB)
//   node scripts/fetch-models.mjs detect          # just the person detector (auto reframe)
//   node scripts/fetch-models.mjs translate       # just the English→Persian translator, 8-bit (~630 MB)
//   node scripts/fetch-models.mjs translate-fp16  # its higher-precision 16-bit version (~1.2 GB, for WebGPU)
//   HF_ENDPOINT=https://my-mirror node scripts/fetch-models.mjs   # use a mirror
import { mkdirSync, existsSync, statSync, createWriteStream, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const endpoint = process.env.HF_ENDPOINT ?? 'https://huggingface.co';
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const args = process.argv.slice(2);
const WHISPER_SIZES = ['tiny', 'base', 'small', 'large-v3-turbo'];
const sizes = args.length ? args.filter((a) => WHISPER_SIZES.includes(a)) : WHISPER_SIZES;
const detector = !args.length || args.includes('detect');
const translate = !args.length || args.includes('translate');
const translateFp16 = args.includes('translate-fp16');

const META = [
  'config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json',
  'tokenizer_config.json', 'special_tokens_map.json', 'added_tokens.json', 'vocab.json',
  'merges.txt', 'normalizer.json',
];
// Decoder q8 (WASM) and q4 (WebGPU); encoder fp32, but turbo's quantized like its decoder (fp32 is
// 2.5 GB). Must match dtypes() in src/engine/stt/models.ts.
const DECODERS = ['onnx/decoder_model_merged_quantized.onnx', 'onnx/decoder_model_merged_q4.onnx'];
const weights = (size) =>
  size === 'large-v3-turbo' ? ['onnx/encoder_model_quantized.onnx', 'onnx/encoder_model_q4.onnx', ...DECODERS] : ['onnx/encoder_model.onnx', ...DECODERS];

const TRIES = 10;
const sizeOf = (f) => (existsSync(f) ? statSync(f).size : 0);
// Sizes are compared byte for byte, so ask for files as they are (not gzipped).
const PLAIN = { 'Accept-Encoding': 'identity' };
const pause = (s) => new Promise((r) => setTimeout(r, s * 1000));

/** The file's size on the server (0 if unknown), or null if it doesn't exist there. */
async function remoteSize(url) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { method: 'HEAD', headers: PLAIN });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (res.headers.get('content-encoding')) return 0; // size of the compressed form: unknown
      return Number(res.headers.get('content-length')) || 0;
    } catch (e) {
      if (i >= TRIES) throw e;
      console.warn('retry', url, e.message);
      await pause(Math.min(30, 2 ** i));
    }
  }
}

/**
 * Download into `<dest>.part`, continuing from where a broken connection (or an earlier run) left
 * off, and move it into place only once it has the server's full size.
 */
async function download(url, dest, total) {
  const part = dest + '.part';
  for (let i = 1; ; i++) {
    try {
      const have = sizeOf(part);
      if (total && have === total) break;
      const res = await fetch(url, { headers: have ? { ...PLAIN, Range: `bytes=${have}-` } : PLAIN });
      if (res.status === 416) break; // already complete
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const append = have > 0 && res.status === 206; // a 200 means the server sent it all again
      await pipeline(Readable.fromWeb(res.body), createWriteStream(part, { flags: append ? 'a' : 'w' }));
      if (!total || sizeOf(part) === total) break;
      throw new Error(`got ${sizeOf(part)} of ${total} bytes`);
    } catch (e) {
      if (i >= TRIES) throw new Error(`${url}: ${e.message} (run the command again to continue)`);
      console.warn(`retry ${i}/${TRIES - 1}`, dest.split('/models/')[1] ?? dest, `${(sizeOf(part) / 1e6).toFixed(1)} MB so far:`, e.message);
      await pause(Math.min(30, 2 ** i));
    }
  }
  if (total && sizeOf(part) !== total) throw new Error(`${url}: got ${sizeOf(part)} of ${total} bytes`);
  renameSync(part, dest);
}

async function fetchRepo(repo, files) {
  for (const file of files) {
    const dest = join(root, 'public/models', repo, file);
    const url = `${endpoint}/${repo}/resolve/main/${file}`;
    const total = await remoteSize(url);
    if (total === null) { console.warn('missing', repo, file); continue; }
    const have = sizeOf(dest);
    if (have && (!total || have === total)) { console.log('skip', repo, file); continue; }
    mkdirSync(dirname(dest), { recursive: true });
    // A file cut short by an older version of this script: continue it instead of keeping it.
    if (have) {
      console.warn('incomplete', repo, file, `${(have / 1e6).toFixed(1)} of ${(total / 1e6).toFixed(1)} MB`);
      if (have < total && !existsSync(dest + '.part')) renameSync(dest, dest + '.part');
      else rmSync(dest);
    }
    await download(url, dest, total);
    console.log('ok  ', repo, file, (sizeOf(dest) / 1e6).toFixed(1) + 'MB');
  }
}

for (const size of sizes) {
  // The "_timestamped" exports also output cross-attentions, which word-level timestamps need.
  await fetchRepo(`onnx-community/whisper-${size}_timestamped`, [...META, ...weights(size)]);
}
// Person detector for auto reframe (YOLOS-tiny, Apache-2.0), quantized: ~10 MB.
if (detector) await fetchRepo('Xenova/yolos-tiny', ['config.json', 'preprocessor_config.json', 'onnx/model_quantized.onnx']);
// English→Persian translation (M2M100-418M, MIT): tokenizer + 8-bit or 16-bit weights.
const M2M_META = ['config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'sentencepiece.bpe.model', 'vocab.json'];
if (translate) await fetchRepo('Xenova/m2m100_418M', [...M2M_META, 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx']);
if (translateFp16) await fetchRepo('Xenova/m2m100_418M', [...M2M_META, 'onnx/encoder_model_fp16.onnx', 'onnx/decoder_model_merged_fp16.onnx']);
