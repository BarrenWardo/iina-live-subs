# JA → EN Realtime Subtitles for IINA (Mac) — Design

Date: 2026-10-13
Status: approved in chat (sections 1, 2r, 3, 4)
Repo: empty (`iina-plugin/`), new project → architectural path

## 1. Intent

- Outcome: IINA plugin for Mac that shows realtime English subtitles for Japanese video, local files and internet streams.
- Non-goals v1: any-language beyond JA→EN, Whistle (EN/DE/FR/ES/IT/NL/PL only, no JA, no translation), EmbeddingGemma-2 in hot path (embedding-only, 768-d vectors, no STT/generation — verified 2026-10-13 via HF model cards).
- Success: EN subs appear within ~2s (local) / ~6-8s (stream) on Apple Silicon, no network calls for inference, toggleable, no separate install.

## 2. Constraints

- Mac-first: macos-arm64 primary, x86_64 best-effort. Metal/CoreML via whisper.cpp.
- No sidecar daemon/service. All assets inside `.iinaplg`; JS orchestrates, bundled native binaries infer.
- IINA plugin runtime: JavaScriptCore (ES2015-ish), APIs via `iina` object: `core`, `mpv`, `event`, `overlay` (webview, `postMessage` only), `menu`, `preferences`, `file` (sandboxed temp/data), `utils` (exec binaries, dialogs), `console`, `http` (not used for inference).
- Offline inference. Stream audio capture needs local-net/file perms only.

## 3. Architecture

```
iina-ja-en-subs.iinaplg/
  Info.json            # main entry main.js, prefs page prefs.html, min IINA 1.4
  main.js              # orchestrator: events, time-pos poll, ffmpeg/whisper exec, overlay push
  bin/
    whisper-cpp        # prebuilt macos-arm64 + x86_64 (two files, select at runtime)
    ffmpeg             # static build, or system fallback with pref override
  models/
    ggml-tiny-ja.bin   # default (fast); base/small optional downloads to data dir
  overlay/
    index.html + subs.js  # bottom-centered subs, postMessage receiver
  prefs.html           # model, chunk, font size, enable, stream delay note
```

- JS never loads models. `main.js` → `iina.utils.exec(bin, args)` → parse stdout JSON → `overlay.postMessage`.
- Model select at runtime by `arch` (arm64 vs x64). Tiny default to hit latency on base M1.

## 4. Data flow

Local file (`file://` or `/path`):
1. `event.on("iina.file-loaded")` → url from `core.status`, reset segment state.
2. Poll `mpv` `time-pos` every 2s → target window `[t+0.2, t+5.2]` with 0.5s overlap.
3. `ffmpeg -ss <start> -t 5 -i <file> -ar 16000 -ac 1 -f wav <tmp>` via sandboxed temp.
4. `whisper-cpp -m <model> -l ja --translate --output-json -f <tmp>` → segments[] (start/end/text).
5. Offset segment times to playback clock, push to overlay, append to in-memory SRT.
6. Prune tmp wavs, advance window. Pause loop when `core.status.paused`.

Internet stream (`http/https`, `m3u8`):
1. Same trigger; detect non-file URL → start single `ffmpeg -i <url> -ar 16000 -ac 1 -f segment -segment_time 5 -segment_wrap 12 tmp_%03d.wav` capture.
2. On each closed segment → whisper translate → overlay with live-edge delay (~6-8s). No seeking.
3. Fallback if ffmpeg can't open URL (auth/yt-protected): set `mpv` `record-file`/`stream-record` to temp file, transcribe growing file in 5s slices.
4. Kill ffmpeg proc on `file-closed` / source change.

## 5. Rendering + prefs

- Overlay webview: bottom-centered, max 2 lines, auto-hide 4s, follows IINA fullscreen. Messages: `{type:"subs", text, id}`, `{type:"clear"}`.
- Menu item `Plugin > JA→EN Subs: on/off` + shortcut; OSD on toggle.
- Optional `mpv sub-add` of generated in-memory SRT for users who prefer native styling (v1: overlay only, flag for native).
- Prefs: model {tiny,base,small}, chunk {3,5,8}s, font size, enable-by-default, stream-delay notice.

## 6. Error handling

- Silence/no-speech → whisper empty → show nothing, advance silently.
- Binary missing/arch mismatch → OSD once + `console.log`, disable loop.
- ffmpeg slice/record fail → retry once with +1s timeout, then pause loop + OSD.
- Whisper OOM/slow (>2x chunk) → auto-suggest smaller model in OSD, stay on tiny.
- Stream disconnect → kill capture, OSD "stream capture lost", resume on next file-loaded.
- Temp growth → cap 12 segments, delete oldest.

## 7. Testing

- Fixtures: 3 JA clips (anime, drama, news, 2 min each) + 1 HLS stream sample.
- Local: M1 + Intel run, assert subs appear, lag <2.5s p50 on tiny/M1, no network egress (monitor).
- Stream: assert live-edge subs appear, delay <10s, no dupes across segments (overlap dedup by text prefix).
- Eyeball EN quality on 20 sampled segments; log WER-ish notes, no hard gate v1.
- Plugin loads with no console errors on IINA 1.4+.

## 8. Open items (deferred)

- Any-language beyond JA, Whisper-MLX upgrade, EmbeddingGemma-2 translation-memory, native subtitle-track styling, keyword bias UI.
