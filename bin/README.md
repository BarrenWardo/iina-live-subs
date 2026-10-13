# `bin/` — native helpers (not in git)

Place prebuilt binaries here (chmod +x):

- `whisper-cpp-arm64`, `whisper-cpp-x64` — from https://github.com/ggerganov/whisper.cpp/releases (Metal/CoreML build for arm64)
- `ffmpeg-arm64`, `ffmpeg-x64` — static builds, e.g. https://evermeet.cx/ffmpeg/ (arm64) or `brew install ffmpeg` + copy

`main.js` selects `<name>-arm64` vs `<name>-x64` at runtime. If a
system `ffmpeg` exists in PATH it is used as fallback (`utils.fileInPath`).

First launch after adding binaries: `xattr -d com.apple.quarantine bin/*`
may be needed once for Gatekeeper.
