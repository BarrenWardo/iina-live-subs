# IINA JA→EN Live Subs

Realtime Japanese → English subtitles for IINA on Mac. Fully local:
`whisper.cpp --translate` runs on-device, audio never leaves the machine.

Spec: `docs/superpowers/specs/2026-10-13-ja-en-subs-design.md`

## Status: engine loop wired (Task 5)

## IINA acceptance drills (user-run, no IINA on build machine)

Node suite: `node tests/run.js` → 61/61 green (this machine).

| # | Drill | Expect | Result |
|---|-------|--------|--------|
| 1 | Load, no binaries | one `setup needed` OSD, menu `Setup needed`, no spam | TBD |
| 2 | JA anime 2 min (tiny, M1) | EN lines, p50 lag <2.5s | TBD |
| 3 | JA drama + news | same as 2 | TBD |
| 4 | Seek / chapter jump | overlay clears, resumes, no stale lines | TBD |
| 5 | Pause / resume, 2x speed | frozen line on pause; subs continue at 2x | TBD |
| 6 | Audio/sub track switch | re-picks map; EN-sub standby engages | TBD |
| 7 | Two windows | independent subs, no shared state | TBD |
| 8 | EN-audio clip (auto) | standby, no garbage | TBD |
| 9 | Silent clip | nothing shown, loop advances | TBD |
| 10 | Direct-mp4 + HLS stream | live-edge subs, delay <10s | TBD |
| 11 | YouTube page URL | `unsupported-stream` standby, one OSD | TBD |
| 12 | 30-min soak | `@tmp` ≤4 segs, `.srt` flushed every 5 min | TBD |
| 13 | Save EN .srt now | file written + native track loaded | TBD |

## Setup (dev)

1. Symlink for live reload (IINA 1.4+):
   `ln -s "$PWD" ~/Library/Application\ Support/com.colliderli.iina/plugins/ja-en-subs.iinaplugin-dev`
2. Add binaries per `bin/README.md`, weights per `models/README.md`.
3. Restart IINA, enable the plugin, watch Window → Log Viewer (`player* - JA→EN Live Subs`).
4. Publish: push to GitHub, users install from repo URL; add `ghRepo`/`ghVersion` to `Info.json` for auto-update.

## Why not EmbeddingGemma / Whistle

- EmbeddingGemma(-2) is embedding-only (outputs 768-d vectors) — no STT, no translation.
- Whistle supports EN/DE/FR/ES/IT/NL/PL only — no Japanese — and transcribes without translating.
