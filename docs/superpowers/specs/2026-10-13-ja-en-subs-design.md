# JA → EN Realtime Subtitles for IINA (Mac) — Design v2

Date: 2026-10-13 (v2: deep review)
Status: v1 approved in chat; v2 adds corrections from API verification
Repo: `iina-plugin/`, new project → architectural path

## 1. Intent

- Outcome: IINA plugin for Mac that shows realtime English subtitles for Japanese video, for **local files and internet streams**.
- Primary use case: Japanese content. v1 supports JA→EN only (source pref: `auto`/`ja`).
- Non-goals v1: languages beyond JA→EN; Whistle as engine (7 langs EN/DE/FR/ES/IT/NL/PL only, no JA, transcription-only — verified 2026-10-13); EmbeddingGemma-2 in hot path (embedding-only, 768-d vectors, no STT/generation — verified via HF model cards); DRM sources (Netflix etc.).
- Success: EN subs within ~2s (local) / ~6-10s (stream) on Apple Silicon, fully offline inference, toggleable, no separate install, no console errors.

## 2. Constraints (verified against IINA Plugin API, index.d.ts 2026-10-13)

- Mac-first: macos-arm64 primary, x86_64 best-effort. whisper.cpp with Metal/CoreML.
- No sidecar daemon. All assets inside `.iinaplugin`; JS orchestrates, bundled native binaries infer.
- Runtime: JavaScriptCore (ES2015-ish, no Node APIs). APIs: `core` (main entry only), `mpv`, `event`, `overlay` (separate webview process, `postMessage(name, data)` / `onMessage(name, handler)`, JSON-serializable only), `menu`, `preferences`, `file` (`@tmp/`, `@data/`, `@audio/:id` pseudo-folders), `utils.exec(file, args, cwd?, stdoutHook?, stderrHook?)` → Promise (one-shot, **no process-kill handle**), `console`, `http` (used only for first-run model download, never for inference audio).
- `Info.json` MUST declare `file-system` permission or `utils.exec` fails.
- Overlay requires window loaded (`core.window.loaded` / `iina.window-loaded`); overlay is non-interactive by default (fine — subs are display-only).
- Main entry runs **per player window**: all transcription state must live in instance scope, never global/shared. `iina.window-will-close` / `mpv.end-file` must stop the loop (no orphan work; exec calls are short-lived so nothing to kill, just stop scheduling).
- Privacy: audio never leaves the device. No telemetry.

## 3. Architecture

```
ja-en-subs.iinaplugin/            # dev: symlink as *.iinaplugin-dev via `iina-plugin link`
  Info.json                       # main entry, prefs page, file-system permission, ghRepo/ghVersion
  main.js                         # per-player orchestrator (ES2015, no bundler needed v1)
  bin/
    whisper-cpp-arm64             # prebuilt, chmod +x
    whisper-cpp-x64
    ffmpeg-arm64                  # static build; system PATH fallback via utils.fileInPath
    ffmpeg-x64
  overlay/
    subs.html                     # loadFile mode; bottom-centered subs, prefers-color-scheme
  prefs.html                      # model, source lang, chunk, font size, enable-by-default, save-SRT
```

- Engine: whisper.cpp `--translate` (JA speech → EN text directly, no separate translator).
- Models NOT bundled in git: first run downloads tiny (default) to `@data/models/` via `http.download` + size check; base/small optional in prefs. Keeps repo/clone small and updates separable from weights.
- Gatekeeper note: bundled binaries need `chmod +x`; document `xattr -d com.apple.quarantine` fallback and that ad-hoc binaries may need one manual approval in System Settings.
- Dev loop: `iina-plugin new` scaffold reference, `iina-plugin link <dir>` for live reload, `iina-plugin pack` → `.iinaplgz`; GitHub repo + `ghVersion` bump for auto-update.
- Rendering v1: overlay `loadFile` mode (richer styling than simpleMode); `postMessage("subs", {id, text, t0, t1})`, `postMessage("clear", {})`. Optional "Save EN .srt" writes cumulative file to `@data/subs/` and offers `core.subtitle.loadTrack(path)` so users get a native track after (not live-reloaded mid-play).

## 4. Data flow

Common:
1. `iina.file-loaded(url)` → reset per-player state (queue, lastWindow, srt buffer), detect `core.status.isNetworkResource`, pick audio source (below), clear overlay, skip if standby conditions (§6).
2. Drive by `mpv.time-pos.changed` + 2s `setInterval` safety net (position can be null when idle). If `core.status.paused` → show frozen line, schedule nothing.
3. Window `[t+0.2, t+N]` (N = chunk pref 3/5/8s, default 5) with 0.5s overlap; speed factor `core.status.speed` scales window (`N/speed`).
4. Short-lived `ffmpeg -ss <start> -t <N> -i <src> -map <audio> -ar 16000 -ac 1 -f wav <@tmp/seg.wav>` → short-lived `whisper-cpp -m <model> -l <ja|auto> --translate --output-json -f <seg>` → parse segments → dedup overlap by text-prefix → offset to playback clock → overlay + SRT buffer → delete wav. Max 1 in-flight job per player (skip tick if busy).

Local file: `<src>` = `core.status.url`; `<audio>` = selected track via `core.audio.currentTrack.id` (`-map 0:a:<idx>` fallback to default audio). Prefer `@audio/:id` pseudo-file when it resolves to avoid re-demux surprises (verify in spike; ffmpeg path is fallback).

Stream (`isNetworkResource`, http/hls): same short-slice pattern against the URL (`ffmpeg -ss <elapsed> -i <url> -t <N> …`). NO long-running capture (unsupported: `utils.exec` has no kill). Live edge carries ~6-10s delay; VOD HLS seek works where server allows, else degrades to live-edge. YouTube/page URLs: ffmpeg cannot open them — use `mpv.getString("stream-open-filename")` resolved URL when available; otherwise OSD "stream type unsupported" and stand by (documented limitation, §6).

## 5. User-behavior matrix (all handled)

- Seek (incl. chapter jump): time-pos discontinuity >1.5s → flush queue, `clear` overlay, restart window at new pos.
- Pause/resume: pause freezes loop + keeps last line; resume restarts window.
- Speed ≠1.0: window scaled (§4); note accuracy drop at >1.5x.
- Track switch mid-play (`core.audio`/`core.subtitle` change): re-pick audio map; re-evaluate standby (§6).
- Playlist advance / open new file: full reset (§4.1).
- Multi-window: state per main-entry instance; `@tmp` filenames include player token (e.g. `seg-<rand>.wav`) to avoid collisions.
- Fullscreen / PiP / music-mode / sidebar: overlay follows video surface; in music-mode (no video) show OSD once and stand by.
- Toggle off via Plugin menu: stop loop, clear overlay, keep SRT buffer for Save.
- Prefs change mid-play: model/chunk apply to next window; no restart needed.
- Long videos (2h+): cap `@tmp` to 4 segs, SRT buffer in memory + incremental flush to `@data/subs/<title>.srt` every 5 min.
- No-audio / muted / very quiet: whisper empty → advance silently, no OSD spam.
- Non-JA content: §6 standby rules; never show forced-JA garbage.

## 6. Standby / skip rules (checked on file-loaded and track change)

- `core.subtitle.tracks` has an active English (or user-understood-lang) track AND pref `standby-when-en-subs` (default ON) → stand by, OSD "EN subs present — JA→EN standby".
- Source-lang pref `ja`: force `-l ja`. Pref `auto` (default): `-l auto`, and if detected lang is English with high confidence → stand by for that window (still show nothing rather than translate EN→EN).
- Music-mode / idle / null position → stand by.
- Unsupported stream (unresolvable URL, DRM) → OSD once + stand by.
- Binary/model missing → OSD once + `console.error`, menu shows "Setup needed"; prefs offers re-download.

## 7. Error handling

- Silence/empty result → advance silently.
- ffmpeg slice fail → retry once (next tick, no `-ss` fast-seek: put `-ss` after `-i`); 3 consecutive fails → pause loop + OSD "audio slice failed".
- whisper slow (>2× chunk): OSD suggests smaller model; auto-drop chunk 5→3s once before suggesting.
- whisper crash (non-zero status): log stderr tail to console, skip window, continue.
- Stream 403/404/unseekable → standby path (§6), no retry storm.
- Temp write fail (sandbox) → OSD + disable for session.
- Overlap-dupes: prefix-match dedup, keep first.
- All errors rate-limit OSD (max 1 per minute per kind).

## 8. Prefs (prefs.html)

- Enabled by default (bool, default ON), source lang (auto/ja), model (tiny/base/small + download state), chunk (3/5/8s), font size, standby-when-EN-subs (ON), save-SRT (OFF), stream notice text. Stored via `preferences` module.

## 9. Testing

- Fixtures: JA anime/drama/news 2-min clips (local) + 1 direct-mp4 stream + 1 HLS VOD. No network egress during inference (monitor).
- Matrix: M1 (arm64) + Intel (x64); IINA 1.4+; tiny default lag p50 <2.5s local / <10s stream; seek/pause/speed/track-switch/multi-window drills per §5; EN-sub-present and EN-audio standby per §6; empty-audio silence.
- Quality: eyeball 20 sampled segments; log notes, no hard gate v1.
- Load: plugin enables with zero console errors; disable/re-enable clean; window close leaves no `@tmp` files.
- Gatekeeper drill: fresh-machine install, binary approval path documented.

## 10. Deferred

- More source languages, mlx-whisper upgrade path, EmbeddingGemma translation-memory, live native-track injection, keyword bias UI, per-line confidence display.
