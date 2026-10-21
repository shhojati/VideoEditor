// Downloads the ONNX models into public/models/ so speech-to-text, auto reframe and translation run
// fully offline. Run ONCE on a machine with internet access, then copy public/models/ to the target machine.
//
//   node scripts/fetch-models.mjs                 # Whisper tiny + base + small, person detector, translation (8-bit)
//   node scripts/fetch-models.mjs base            # just one Whisper size
//   node scripts/fetch-models.mjs detect          # just the person detector (auto reframe)
//   node scripts/fetch-models.mjs translate       # just the English→Persian translator, 8-bit (~630 MB)
//   node scripts/fetch-models.mjs translate-fp16  # its higher-precision 16-bit version (~1.2 GB, for WebGPU)
//   HF_ENDPOINT=https://my-mirror node scripts/fetch-models.mjs   # use a mirror
import { mkdirSync, existsSync, statSync, createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const endpoint = process.env.HF_ENDPOINT ?? 'https://huggingface.co';
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const args = process.argv.slice(2);
const WHISPER_SIZES = ['tiny', 'base', 'small'];
const sizes = args.length ? args.filter((a) => WHISPER_SIZES.includes(a)) : WHISPER_SIZES;
const detector = !args.length || args.includes('detect');
const translate = !args.length || args.includes('translate');
const translateFp16 = args.includes('translate-fp16');

const META = [
  'config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json',
  'tokenizer_config.json', 'special_tokens_map.json', 'added_tokens.json', 'vocab.json',
  'merges.txt', 'normalizer.json',
];
// encoder fp32 + decoder q8 (WASM) and q4 (WebGPU). Must match DTYPES in src/engine/stt.
const WEIGHTS = ['onnx/encoder_model.onnx', 'onnx/decoder_model_merged_quantized.onnx', 'onnx/decoder_model_merged_q4.onnx'];

async function fetchRepo(repo, files) {
  for (const file of files) {
    const dest = join(root, 'public/models', repo, file);
    if (existsSync(dest) && statSync(dest).size > 0) { console.log('skip', repo, file); continue; }
    mkdirSync(dirname(dest), { recursive: true });
    const res = await fetch(`${endpoint}/${repo}/resolve/main/${file}`);
    if (!res.ok) { console.warn('missing', repo, file, res.status); continue; }
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
    console.log('ok  ', repo, file, (statSync(dest).size / 1e6).toFixed(1) + 'MB');
  }
}

for (const size of sizes) {
  // The "_timestamped" exports also output cross-attentions, which word-level timestamps need.
  await fetchRepo(`onnx-community/whisper-${size}_timestamped`, [...META, ...WEIGHTS]);
}
// Person detector for auto reframe (YOLOS-tiny, Apache-2.0), quantized: ~10 MB.
if (detector) await fetchRepo('Xenova/yolos-tiny', ['config.json', 'preprocessor_config.json', 'onnx/model_quantized.onnx']);
// English→Persian translation (M2M100-418M, MIT): tokenizer + 8-bit or 16-bit weights.
const M2M_META = ['config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'sentencepiece.bpe.model', 'vocab.json'];
if (translate) await fetchRepo('Xenova/m2m100_418M', [...M2M_META, 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx']);
if (translateFp16) await fetchRepo('Xenova/m2m100_418M', [...M2M_META, 'onnx/encoder_model_fp16.onnx', 'onnx/decoder_model_merged_fp16.onnx']);
