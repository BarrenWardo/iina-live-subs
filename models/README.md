# `models/` — whisper weights (not in git, downloaded on first run)

Expected files (ggml format for whisper.cpp):

- `ggml-tiny.bin` (default, ~75MB)
- `ggml-base.bin` (~145MB, optional)
- `ggml-small.bin` (~250MB, optional)

At runtime the plugin looks in IINA's `@data/models/` (auto-downloaded on
first play). A copy here is handy for offline CLI testing only, e.g.:
`./bin/whisper-cpp-arm64 -m models/ggml-tiny.bin -f clip.wav -l auto --translate -oj -of /tmp/out`
Download: `https://huggingface.co/ggerganov/whisper.cpp`.
The plugin prefers `@data/models/` at runtime so IINA updates never wipe
weights; this folder is the dev/testing fallback.
