// Downloads Whisper ONNX models into public/models/ so speech-to-text runs fully offline.
// Run ONCE on a machine with internet access, then copy public/models/ to the target machine.
//
//   node scripts/fetch-models.mjs                 # tiny + base + small
//   node scripts/fetch-models.mjs base            # just one
//   HF_ENDPOINT=https://my-mirror node scripts/fetch-models.mjs   # use a mirror
import { mkdirSync, existsSync, statSync, createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const endpoint = process.env.HF_ENDPOINT ?? 'https://huggingface.co';
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const sizes = process.argv.slice(2).length ? process.argv.slice(2) : ['tiny', 'base', 'small'];

const META = [
  'config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json',
  'tokenizer_config.json', 'special_tokens_map.json', 'added_tokens.json', 'vocab.json',
  'merges.txt', 'normalizer.json',
];
// encoder fp32 + decoder q8 (WASM) and q4 (WebGPU). Must match DTYPES in src/engine/stt.
const WEIGHTS = ['onnx/encoder_model.onnx', 'onnx/decoder_model_merged_quantized.onnx', 'onnx/decoder_model_merged_q4.onnx'];

for (const size of sizes) {
  // The "_timestamped" exports also output cross-attentions, which word-level timestamps need.
  const repo = `onnx-community/whisper-${size}_timestamped`;
  for (const file of [...META, ...WEIGHTS]) {
    const dest = join(root, 'public/models', repo, file);
    if (existsSync(dest) && statSync(dest).size > 0) { console.log('skip', repo, file); continue; }
    mkdirSync(dirname(dest), { recursive: true });
    const res = await fetch(`${endpoint}/${repo}/resolve/main/${file}`);
    if (!res.ok) { console.warn('missing', repo, file, res.status); continue; }
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
    console.log('ok  ', repo, file, (statSync(dest).size / 1e6).toFixed(1) + 'MB');
  }
}
