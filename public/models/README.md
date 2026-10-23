# Models (self-hosted): Whisper and the person detector

Not committed (too large). On a machine with internet access run:

    node scripts/fetch-models.mjs                  # tiny + base + small + large-v3-turbo (~3 GB)
    node scripts/fetch-models.mjs large-v3-turbo   # just one (turbo is the most accurate for Persian)

then copy this folder to the target machine. Set `HF_ENDPOINT` to use a mirror.
Expected layout: `public/models/onnx-community/whisper-<size>_timestamped/{config.json,…,onnx/*.onnx}`.
The `_timestamped` exports give word timings (animated captions). Older installs with the plain
`whisper-<size>` folders still work, with segment timings only; the app shows a hint for them.

Auto reframe uses `public/models/Xenova/yolos-tiny/{config.json,preprocessor_config.json,onnx/model_quantized.onnx}`
(`node scripts/fetch-models.mjs detect` fetches just that).
Translation (English→Persian) uses `public/models/Xenova/m2m100_418M/` (`fetch-models.mjs translate`, ~630 MB;
`translate-fp16` adds the 16-bit version, ~1.2 GB).
