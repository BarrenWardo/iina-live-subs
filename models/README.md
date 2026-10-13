# `models/` — whisper weights (not in git, downloaded on first run)

Expected files (ggml format for whisper.cpp):

- `ggml-tiny.bin` (default, ~75MB)
- `ggml-base.bin` (~145MB, optional)
- `ggml-small.bin` (~250MB, optional)

Download: `https://huggingface.co/ggerganov/whisper.cpp` or
`sh ./models/download-ggml-model.sh tiny` from whisper.cpp releases.
The plugin prefers `@data/models/` at runtime so IINA updates never wipe
weights; this folder is the dev/bundled fallback.
