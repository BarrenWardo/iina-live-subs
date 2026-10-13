# `bin/` — native helpers for CLI testing only (not in git)

**In IINA these files are never used**: IINA's path API rejects relative
bundle paths, so the plugin downloads the same binaries once into its
`@data/bin/` (absolute paths) from the GitHub release. Put files here only
to run the engine from a terminal.

- `whisper-cpp-arm64` — built from source (Release + Metal)
- `ffmpeg-arm64` — static build
