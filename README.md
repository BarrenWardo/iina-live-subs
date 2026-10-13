# IINA JA→EN Live Subs

Realtime Japanese → English subtitles for IINA on Mac. Fully local:
`whisper.cpp --translate` runs on-device, audio never leaves the machine.

Spec: `docs/superpowers/specs/2026-10-13-ja-en-subs-design.md`

## Status: engine loop wired (Task 5)

## IINA load drill (user-run, no IINA on build machine)

1. `ln -s "$PWD" ~/Library/Application\ Support/com.colliderli.iina/plugins/ja-en-subs.iinaplugin-dev`
2. Restart IINA → Window → Log Viewer → expect `ja-en-subs: started (player …)`, zero errors.
3. Plugin menu shows `JA→EN Subs: On`; toggle clears overlay.
4. Without binaries/model: play JA clip → one OSD `setup needed`, no subs, no error spam.
5. With binaries/model: EN lines appear; seek flushes; pause freezes.

## Setup (dev)

1. Symlink for live reload (IINA 1.4+):
   `ln -s "$PWD" ~/Library/Application\ Support/com.colliderli.iina/plugins/ja-en-subs.iinaplugin-dev`
2. Add binaries per `bin/README.md`, weights per `models/README.md`.
3. Restart IINA, enable the plugin, watch Window → Log Viewer (`player* - JA→EN Live Subs`).
4. Publish: push to GitHub, users install from repo URL; add `ghRepo`/`ghVersion` to `Info.json` for auto-update.

## Why not EmbeddingGemma / Whistle

- EmbeddingGemma(-2) is embedding-only (outputs 768-d vectors) — no STT, no translation.
- Whistle supports EN/DE/FR/ES/IT/NL/PL only — no Japanese — and transcribes without translating.
