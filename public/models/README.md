# Whisper models (self-hosted)

Not committed (too large). On a machine with internet access run:

    node scripts/fetch-models.mjs            # tiny + base + small (~1 GB)
    node scripts/fetch-models.mjs small      # just one

then copy this folder to the target machine. Set `HF_ENDPOINT` to use a mirror.
Expected layout: `public/models/onnx-community/whisper-<size>/{config.json,…,onnx/*.onnx}`.
