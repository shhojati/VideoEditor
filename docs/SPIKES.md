# Phase 0 — Spike results

Date: 2026-10-20 · Browser: Chromium (Claude desktop in-app browser, WebGPU available) · Machine: owner's Windows 11 dev box.

Run them yourself: `npm run dev`, open <http://localhost:5173/spikes/>.

## Owner decisions (answers to plan §10)

| Question | Answer |
|---|---|
| Aspect ratio | Both; default 16:9 1080p, presets 9:16 / 1:1 / 4:5 |
| Typical input | Up to 5 minutes, 1080p |
| Deployment | Internal network only → everything self-hosted |
| Whisper models | tiny / base / small, selectable |

## Libraries chosen (versions from the private npm mirror)

| Concern | Package | Version |
|---|---|---|
| Demux / decode / encode / mux | `mediabunny` | 1.61 |
| Speech-to-text | `@huggingface/transformers` (ONNX Runtime Web) | 4.3 |
| Fonts | `vazirmatn`, `@fontsource/inter` | 33.0 / 5.3 |
| Build | `vite` 8, `typescript` 7 | |

All packages resolved from `repo.etadbir.com`. Newer than the plan assumed (React 19, Vite 8, TS 7); no API blockers found.

## Self-hosting (plan §2.1)

- `scripts/copy-assets.mjs` copies fonts and ONNX Runtime WASM from `node_modules` into `public/fonts` and `public/wasm`.
- `scripts/fetch-models.mjs` downloads Whisper ONNX files into `public/models/onnx-community/whisper-{tiny,base,small}`. Run it once on a machine with internet (or with `HF_ENDPOINT` pointing to a mirror), then copy `public/models/` over.
- transformers.js defaults to fetching ORT WASM from **cdn.jsdelivr.net** — we override `env.backends.onnx.wasm.wasmPaths` to `/wasm/…`, and set `allowRemoteModels = false`, `localModelPath = '/models/'`.
- Dev/preview server sends COOP/COEP headers → `crossOriginIsolated = true` → multi-threaded WASM. **Production static host must send the same two headers.**

## Spike 1 — Decode + seek ✅

`spikes/decode.html` · Mediabunny `Input` + `BlobSource` + `CanvasSink`.

| Metric | Result | Budget |
|---|---|---|
| Random seek (20 seeks, 1280×720 H.264) | median 92 ms, max 144 ms | < 500 ms |
| Frame accuracy | requested time always inside returned frame's window | ≤ 1 frame |
| Sequential decode | 225 fps | ≥ 30 fps |

Notes: `BlobSource` reads the `File` lazily, so whole files are never loaded into RAM. Seek cost depends on GOP length; long-GOP camera files will be slower — re-measure with real footage in Phase 4.

## Spike 2 — Export MP4 ✅

`spikes/export.html` · `Output` + `Mp4OutputFormat` + `CanvasSource` (avc) + `AudioBufferSource` (aac).

- `canEncode`: avc ✅, **aac ✅**, opus ✅ → no Opus fallback needed on Chromium/Windows.
- 5 s 1280×720@30 + 48 kHz stereo sine: **1.97 s** to export (≈ 2.5× faster than real time), 0.74 MB.
- Result plays in Chromium `<video>`: duration 5.013 s, 1280×720.
- ⚠ Not yet verified in VLC / Windows player — no ffprobe/VLC on this machine. Owner: click "download" on the spike page and open the file in a desktop player once.

## Spike 3 — Persian text on canvas ✅

`spikes/persian.html` · `ctx.direction = 'rtl'`, Vazirmatn variable font, stroke + rounded background box.

- Letter joining correct; `،` `؟` `.` `!` land at the visually correct (left) end.
- Mixed bidi (`نسخه 2.5 از React …`) ordered correctly; Persian digits render.
- Must `await document.fonts.load('… Vazirmatn')` before first draw (also inside the export worker — fonts must be loaded via `FontFace` in workers).

## Spike 4 — Whisper offline ⚠ works, accuracy is the risk

`spikes/whisper.html` + `spikes/stt.worker.ts`. Test audio: 12 Persian Common Voice clips concatenated (70 s, crowd-sourced, mixed speakers/mics — harder than a talking-head video). English JFK clip available as a sanity check.

| Model | Device | Load | Transcribe 70 s | RTF | Quality (Persian) |
|---|---|---|---|---|---|
| base | WebGPU (q4 decoder) | 6–15 s | 63–95 s | 0.9–1.35× | Poor: phonetic guesses, a repetition loop without `no_repeat_ngram_size` |
| small | WebGPU (q4 decoder) | 12 s | 204 s | 2.9× | Usable draft: most sentences recognisable, needs manual correction; one hallucinated tail in the last window |

- ✅ Worker resource timing shows only `http://localhost:5173` — models and WASM are fully self-hosted.
- ⚠ RTF measured with the browser pane in the background (may be throttled) on an unknown GPU — re-measure in a foreground Chrome tab on the target laptops.
- At 2.9× RTF, a 5-minute video takes ~15 minutes with `small`. Fine as a background job with progress (plan §6), but not "instant".
- Hallucination/repetition at window ends: mitigated with `no_repeat_ngram_size: 4`; Phase 6d should also (a) cut windows on silence (VAD) rather than fixed 30 s, (b) drop segments whose text repeats or whose timestamps run past the audio end.
- Disk: tiny ≈ 0.1 GB, base ≈ 0.25 GB, small ≈ 0.7 GB (encoder fp32 + q8 & q4 decoders).

## Plan changes / open items

1. **No plan blockers.** Mediabunny covers decode, encode and MP4 muxing; mp4box.js / ffmpeg.wasm fallbacks are not needed.
2. **[ASK] Persian STT quality.** Stock Whisper `small` gives a draft that needs editing; `base` is not usable for Persian. Options:
   - (a) Ship tiny/base/small as planned, default `small` for Persian, and rely on the review step. Zero extra work.
   - (b) Also offer `whisper-large-v3-turbo` (q4 ≈ 0.7 GB, WebGPU only) — much better multilingual accuracy, probably slower; needs a spike.
   - (c) Use a Persian fine-tuned Whisper (several exist on Hugging Face, e.g. `whisper-small-persian` variants). They are PyTorch-only; they need a one-time ONNX conversion with Python + `optimum` (Python is not installed here).
3. Production hosting must send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.
4. Owner to-do: open the spike-2 MP4 in VLC / Windows player once.
