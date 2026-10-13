// JA→EN Live Subs — main entry (runs once per player window).
// All state below is per-player by design. Do not hoist across instances.
const { core, event, mpv, overlay, menu, preferences, file, utils, console } = iina;
const prefs = require("./lib/prefs.js");
const standby = require("./lib/standby.js");
const slicer = require("./lib/slicer.js");
const engine = require("./lib/engine.js");
const loop = require("./lib/loop.js");
const stream = require("./lib/stream.js");
const setup = require("./lib/setup.js");
const subs = require("./lib/subs.js");
const srtsave = require("./lib/srt-save.js");
var logfile = null;
try {
  logfile = require("./lib/logfile.js");
} catch (e) {}
if (!logfile || !logfile.create) {
  // IINA require() yields null instead of throwing; never let logging
  // take down the whole entry. No-op fallback, real logger when present.
  logfile = {
    create: function () { return { lines: [], dirty: false, max: 0 }; },
    push: function () {},
    flush: function () { return false; },
  };
}

// Ruling: lib/diag.js inlined here instead of required. IINA's require
// returns null (no throw) when a module fails to evaluate, which made
// Diagnose die with "null is not an object". Zero deps = zero risk.
function diagReport(info) {
  return [
    "diag url=" + info.url,
    "diag stream=" + info.isStream + " streamOk=" + info.streamOk,
    "diag bins ffmpeg=" + info.ffmpeg + " whisper=" + info.whisper + " model=" + info.model,
    "diag status idle=" + info.idle + " paused=" + info.paused + " pos=" + info.pos +
      " speed=" + info.speed,
    "diag standby=" + info.standby + " subs=" + info.subTracks +
      " audio=" + info.audioTracks,
    "diag loop busy=" + info.busy + " fails=" + info.fails +
      " pausedLoop=" + info.pausedLoop + " segs=" + info.segs,
    "diag prefs lang=" + info.lang + " model=" + info.modelPref +
      " chunk=" + info.chunk,
    "diag log=" + (logPath() || "?") + " (open this file to see everything)",
    "diag plugin=" + PLUGIN_VERSION,
  ];
}

// Bump with each release so Diagnose always tells us what code runs.
var PLUGIN_VERSION = "0.2.7-dev";

function diagSummary(info) {
  if (info.standby && info.standby !== "null") return "standby: " + info.standby;
  var missing = [];
  if (!info.ffmpeg) missing.push("ffmpeg");
  if (!info.whisper) missing.push("whisper-cpp");
  if (!info.model) missing.push("model");
  if (missing.length > 0) {
    return "setup needed: missing " + missing.join("+") +
      " (files seen f" + info.f + "w" + info.w + "m" + info.m +
      (info.blocked ? ", waiting: " + info.blocked : "") + ") @ " + info.dataDir;
  }
  if (info.pausedLoop) return "paused after slice fails";
  return info.segs + " segments so far";
}

// Startup self-check: IINA require() yields null (never throws) on failure.
// Log any dead module at error level so it can't hide like diag did.
(function checkLibs() {
  var missing = [];
  var libs = { prefs: prefs, standby: standby, slicer: slicer, engine: engine, loop: loop, stream: stream, setup: setup, subs: subs, srtsave: srtsave };
  for (var k in libs) {
    if (!libs[k]) missing.push(k);
  }
  if (missing.length > 0) {
    try { console.error("ja-en-subs: dead modules: " + missing.join(",")); } catch (e) {}
  }
})();

var state = {
  enabled: true,
  timer: null,
  segCounter: 0,
  osdCount: {},
  playerTag: Math.random().toString(36).slice(2, 8),
  loop: loop.createState(),
  lastFlush: 0,
  dl: {},
  log: logfile.create(300),
  logPath: null,
  bins: null, // {ffmpeg, whisper, model} resolved per file
  url: null,
  isStream: false,
};

function pref(key, fallback) {
  return prefs.get(key, fallback);
}

// Persistent debug log (@data/logs/debug.log) + console mirror.
// The Log Viewer can filter debug out; the file cannot hide.
function logPath() {
  if (!state.logPath) {
    try {
      state.logPath = utils.resolvePath("@data/logs/debug.log");
      ensureParent(state.logPath);
    } catch (e) {
      state.logPath = null;
    }
  }
  return state.logPath;
}

function blog(msg) {
  try {
    logfile.push(state.log, msg);
  } catch (e) {}
  try {
    console.log("ja-en-subs: " + msg);
  } catch (e) {}
  var p = logPath();
  if (p) {
    try {
      logfile.flush(state.log, function (pa, c) { file.write(pa, c); }, p);
    } catch (e) {}
  }
}

function blogErr(msg) {
  try {
    logfile.push(state.log, "ERROR " + msg);
  } catch (e) {}
  try {
    console.error("ja-en-subs: " + msg);
  } catch (e) {}
  var p = logPath();
  if (p) {
    try {
      logfile.flush(state.log, function (pa, c) { file.write(pa, c); }, p);
    } catch (e) {}
  }
}
function osdOncePerMin(kind, msg) {
  var now = Date.now();
  if (!state.osdCount[kind] || now - state.osdCount[kind] > 60000) {
    state.osdCount[kind] = now;
    try { core.osd(msg); } catch (e) {}
  }
}

function tmpWav() {
  state.segCounter += 1;
  return "@tmp/jaen-" + state.playerTag + "-" + state.segCounter + ".wav";
}

// Standby rules live in lib/standby.js (spec §6). Returns reason or null.
function standbyReason() {
  if (!pref("enabled", true)) return "disabled";
  if (state.isStream && !state.streamOk) return "unsupported-stream";
  try {
    // Player is buffering (cache-starved): stop competing for bandwidth.
    if (mpv.getFlag("paused-for-cache")) return "buffering";
  } catch (e) {}
  try {
    return standby.check(core.status, core.subtitle.tracks, {
      standbyWhenEnSubs: pref("standbyWhenEnSubs", true),
    });
  } catch (e) {
    return null;
  }
}

// Binary/model readiness (spec §3). Everything resolves to ABSOLUTE
// @data paths — IINA's parsePath rejects relative bundle paths, so
// "bin/…" can never execute in-app (bundle bin/ is CLI-testing only).
// Missing pieces download once from release assets / HF.
function refreshMenu() {
  if (!state.menuItem) return;
  var st = setup.setupState({
    ffmpeg: state.bins && state.bins.ffmpeg,
    whisper: state.bins && state.bins.whisper,
    model: state.bins && state.bins.model,
  });
  var on = pref("enabled", true);
  var title = st === "ready"
    ? (on ? "JA→EN Subs: On" : "JA→EN Subs: Off")
    : "JA→EN Subs: Setup needed";
  if (title === state.menuTitle) return;
  state.menuTitle = title;
  state.menuItem.title = title;
  try { menu.forceUpdate(); } catch (e) {}
}

var BIN_ASSETS = { ffmpeg: "ffmpeg-arm64", whisper: "whisper-cpp-arm64" };

function dataDir() {
  // NOTE: the trailing slash is load-bearing — IINA's parsePath only
  // matches "@data/" (bare "@data" is rejected as non-absolute).
  try {
    return utils.resolvePath("@data/");
  } catch (e) {
    return null;
  }
}

function ensureParent(dest) {
  // Neither file.write nor http.download creates intermediate dirs, and
  // JS has no mkdir — so make them via /bin/mkdir (absolute, allowed).
  var i = dest.lastIndexOf("/");
  if (i <= 0) return;
  var dir = dest.slice(0, i);
  try {
    utils.exec("/bin/mkdir", ["-p", dir]);
  } catch (e) {}
  try {
    file.write(dest.slice(0, i) + "/.keep", "x");
  } catch (e) {}
}

function queueDownload(kind, url, dest) {
  if (state.dl[kind]) return;
  state.dl[kind] = true;
  ensureParent(dest);
  try {
    var http = iina.http;
    setup.ensureFile(
      function (u, d) { return http.download(u, d); },
      function (p) { return file.exists(p); },
      url, dest
    ).then(function (p) {
      state.dl[kind] = false;
      if (p) {
        if (kind === "model") state.bins.model = p;
        else state.bins[kind] = p;
        osdOncePerMin("setup", "JA→EN: " + kind + " ready");
      } else {
        blogErr("download failed: " + kind);
        osdOncePerMin("setup", "JA→EN: " + kind + " download failed — retrying");
        state.dlCooldownUntil = Date.now() + 60000;
      }
      refreshMenu();
    });
    if (kind === "model") osdOncePerMin("setup", "JA→EN: downloading speech model (once)…");
    else osdOncePerMin("setup", "JA→EN: downloading " + kind + " (once)…");
  } catch (e) {
    state.dl[kind] = false;
  }
}

function ensureBins() {
  var wantModel = "tiny";
  try {
    wantModel = pref("model", "tiny");
  } catch (e) {}
  if (state.bins && state.bins.ffmpeg && state.bins.whisper && state.bins.model) {
    if (state.bins.modelName === wantModel) return state.bins;
    state.bins.model = null; // model pref changed → re-resolve below
  }
  if (state.dlCooldownUntil && Date.now() < state.dlCooldownUntil) return null;
  var dir = dataDir();
  if (!dir) return null;
  var ffmpeg = setup.binPath(dir, "ffmpeg");
  var whisper = setup.binPath(dir, "whisper-cpp");
  var model = null;
  try {
    model = engine.modelPath(dir + "/models", wantModel);
  } catch (e) {}
  var needDl = false;
  try {
    if (!file.exists(ffmpeg)) { queueDownload("ffmpeg", setup.binAssetUrl(BIN_ASSETS.ffmpeg), ffmpeg); needDl = true; }
  } catch (e) { needDl = true; }
  try {
    if (!file.exists(whisper)) { queueDownload("whisper", setup.binAssetUrl(BIN_ASSETS.whisper), whisper); needDl = true; }
  } catch (e) { needDl = true; }
  try {
    if (!model || !file.exists(model)) {
      queueDownload("model", (setup.MODEL_URLS[wantModel] || setup.MODEL_URLS.tiny), engine.modelPath(dir + "/models", wantModel));
      needDl = true;
      model = null;
    }
  } catch (e) {
    needDl = true;
    model = null;
  }
  state.bins = { ffmpeg: ffmpeg, whisper: whisper, model: model, modelName: wantModel };
  state.binScanAt = Date.now();
  state.blockedWhy = null;
  var st = setup.setupState(state.bins);
  if (st !== "ready" && !needDl) {
    osdOncePerMin("setup", "JA→EN: setup needed (binaries/model) — see README");
    blogErr("setup state " + st);
  }
  // Visible breadcrumb: which absolute paths were checked and what exists.
  // Logged only when the missing-set changes (no per-tick spam).
  var have = "f" + existsQuiet(ffmpeg) + "w" + existsQuiet(whisper) + "m" + existsQuiet(model);
  if (st !== "ready" && have !== state.lastHave) {
    state.lastHave = have;
    blogErr("bins dir=" + dir + " ffmpeg=" + have.charAt(1) + " whisper=" + have.charAt(3) + " model=" + have.charAt(5));
  }
  refreshMenu();
  return st === "ready" ? state.bins : null;
}

function existsQuiet(p) {
  if (!p) return 0;
  try {
    return file.exists(p) ? 1 : 0;
  } catch (e) {
    return 0;
  }
}

function phrase(n) {
  return n === 1 ? "1 segment" : n + " segments";
}

function makeCtx() {
  return {
    standbyCheck: standbyReason,
    isPaused: function () { return core.status.paused; },
    getPos: function () { return core.status.position; },
    getChunk: function () {
      var c = Number(pref("chunkSecs", 5));
      if (!(c >= 2)) return c > 0 && c < 2 ? 2 : 5;
      if (c > 10) return 10;
      return c;
    },
    getSpeed: function () { return core.status.speed || 1; },
    now: function () { return Date.now(); },
    tmpPath: tmpWav,
    slice: function (wav, start, len, slow) {
      var bins = ensureBins();
      if (!bins) return Promise.resolve("not-ready");
      var src = state.isStream ? state.streamUrl : state.url;
      var aid = null;
      try {
        var tracks = core.audio.tracks || [];
        for (var i = 0; i < tracks.length; i++) {
          if (tracks[i].isSelected) { aid = tracks[i].id; break; }
        }
      } catch (e) {}
      if (aid !== state.lastAid) {
        state.lastAid = aid;
        state.mapFallback = false; // user switched track → retry real map
      }
      var audioIdx = state.mapFallback ? null : aid;
      var args = slow
        ? slicer.buildSliceArgsSlow(src, audioIdx, start, len)
        : slicer.buildSliceArgs(src, audioIdx, start, len);
      return slicer.slice(function (b, a) { return utils.exec(b, a); }, bins.ffmpeg, args, wav).then(function (st) {
        if (st !== 0 && audioIdx !== null && !state.mapFallback) state.mapFallback = true;
        return st;
      });
    },
    transcribe: function (wav) {
      var bins = ensureBins();
      if (!bins) return Promise.resolve([]);
      var lang = pref("sourceLang", "auto");
      return utils.exec(bins.whisper, engine.buildWhisperArgs(bins.model, wav, lang)).then(function (res) {
        var raw = null;
        try {
          raw = file.read(engine.jsonOutPath(wav));
        } catch (e) {}
        if (!raw) raw = res.stdout; // fallback if sidecar unreadable
        if (res.status !== 0 && !raw) {
          blogErr("whisper exit " + res.status + ": " + String(res.stderr).slice(-300));
          return [];
        }
        if (lang === "auto") {
          var detected = engine.detectLang(raw);
          if (detected && /^en/i.test(detected)) return [];
        }
        return engine.parseWhisperJson(raw);
      });
    },
    postSubs: function (d) {
      try {
        overlay.postMessage("subs", { text: d.text, fontSize: pref("fontSize", 22) });
      } catch (e) {}
    },
    postClear: function () {
      try { overlay.postMessage("clear", {}); } catch (e) {}
    },
    osd: function (m) { osdOncePerMin("loop", m); },
    removeTmp: function (p) {
      try { file.delete(p); } catch (e) {}
    },
  };
}

function cleanupTmps(list) {
  for (var i = 0; i < list.length; i++) {
    try { file.delete(list[i]); } catch (e) {}
  }
}

function resetForNewFile(url) {
  cleanupTmps(state.loop.tmpFiles);
  state.loop = loop.createState();
  state.lastResult = null;
  state.bins = null;
  state.binScanAt = 0;
  state.dl = {};
  state.mapFallback = false;
  state.lastAid = undefined;
  state.lastFlush = 0;
  state.segCounter = 0;
  state.url = url;
  try {
    state.isStream = core.status.isNetworkResource;
  } catch (e) {
    state.isStream = false;
  }
  state.streamUrl = url;
  state.streamOk = true;
  if (state.isStream) {
    try {
      state.streamUrl = stream.resolveUrl(url, function (n) { return mpv.getString(n); });
    } catch (e) {
      state.streamUrl = url;
    }
    state.streamOk = stream.isSliceable(state.streamUrl);
    if (!state.streamOk) {
      osdOncePerMin("stream", "JA→EN: page-URL streams are unsupported — standby");
    }
  }
  try { overlay.postMessage("clear", {}); } catch (e) {}
  blog("new file: " + safeUrlLog(url) + (state.isStream ? " (stream)" : ""));
}

function safeUrlLog(url) {
  return String(url || "").split("?")[0].slice(0, 160);
}

function saveSrtNow(announce) {
  if (state.loop.cumSegs.length === 0) {
    if (announce) osdOncePerMin("srt", "JA→EN: nothing transcribed yet");
    return;
  }
  var rel = srtsave.srtPathFor(core.status.title);
  try {
    subs.flushSrt(function (p, c) { file.write(p, c); }, rel, subs.toSrt(state.loop.cumSegs));
    state.lastFlush = Date.now();
    if (announce) {
      try {
        core.subtitle.loadTrack(utils.resolvePath(rel));
        core.osd("JA→EN: saved + loaded EN track");
      } catch (e) {
        core.osd("JA→EN: .srt saved");
      }
    }
  } catch (e) {
    if (announce) osdOncePerMin("srt", "JA→EN: could not save .srt");
  }
}

function tick() {
  if (state.loop.busy) return; // avoid a ctx allocation per time-pos event
  var p;
  try {
    p = loop.tick(state.loop, makeCtx());
  } catch (e) {
    blogErr("tick threw: " + (e && e.message));
    return;
  }
  p.then(function (r) {
    // Log terminal/standby transitions (not every tick): silence is why
    // "no subs" was undebuggable.
    var quiet = (r === "ok" || r === "busy");
    if (r !== state.lastResult && !quiet) {
      blog("state -> " + r);
    }
    state.lastResult = r;
    if (!quiet && r !== "paused") {
      blog("tick -> " + r + " (" + phrase(state.loop.cumSegs.length) + ")");
    }
    if (r === "ok" && pref("saveSrt", false) && srtsave.shouldFlush(state.lastFlush, Date.now())) {
      saveSrtNow(false);
    }
  }, function (e) {
    blogErr("tick rejected: " + (e && e.message));
  });
}

function safeGet(fn, fallback) {
  try {
    var v = fn();
    return v === undefined ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function gatherDiag() {
  var bins = state.bins || {};
  var dir = safeGet(dataDir, "?");
  return {
    url: safeUrlLog(state.url),
    isStream: safeGet(function () { return !!state.isStream; }, false),
    streamOk: !!state.streamOk,
    dataDir: dir,
    blocked: state.blockedWhy || null,
    ffmpeg: bins.ffmpeg || null,
    whisper: bins.whisper || null,
    model: bins.model || null,
    f: dir === "?" ? "?" : existsQuiet(dir + "/bin/ffmpeg"),
    w: dir === "?" ? "?" : existsQuiet(dir + "/bin/whisper-cpp"),
    m: dir === "?" ? "?" : existsQuiet(dir + "/models/ggml-" + safeGet(function () { return pref("model", "tiny"); }, "tiny") + ".bin"),
    idle: safeGet(function () { return core.status.idle; }, "?"),
    paused: safeGet(function () { return core.status.paused; }, "?"),
    pos: safeGet(function () { return core.status.position; }, "?"),
    speed: safeGet(function () { return core.status.speed; }, "?"),
    standby: safeGet(standbyReason, "?"),
    subTracks: safeGet(function () { return (core.subtitle.tracks || []).length; }, "?"),
    audioTracks: safeGet(function () { return (core.audio.tracks || []).length; }, "?"),
    busy: state.loop.busy,
    fails: state.loop.fails,
    pausedLoop: state.loop.pausedLoop,
    segs: state.loop.cumSegs.length,
    lang: pref("sourceLang", "auto"),
    modelPref: pref("model", "tiny"),
    chunk: pref("chunkSecs", 5),
  };
}

function showOverlay() {
  try { overlay.loadFile("overlay/subs.html"); } catch (e) {}
  try { overlay.show(); } catch (e) {}
}

function start() {
  try {
    if (core.window.loaded) {
      showOverlay();
    } else {
      event.on("iina.window-loaded", showOverlay);
    }
  } catch (e) {
    showOverlay();
  }
  event.on("iina.file-loaded", function (url) { resetForNewFile(url); });
  event.on("iina.window-will-close", function () {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    cleanupTmps(state.loop.tmpFiles);
    try { overlay.postMessage("clear", {}); } catch (e) {}
  });
  try {
    event.on("mpv.seek", function () { loop.notifySeek(state.loop, makeCtx()); });
  } catch (e) {}
  try {
    event.on("mpv.time-pos.changed", tick);
  } catch (e) {}
  state.timer = setInterval(tick, 2000);

  var toggle = menu.item("JA→EN Subs: On", function (item) {
    var on = !pref("enabled", true);
    preferences.set("enabled", on);
    refreshMenu();
    if (!on) { try { overlay.postMessage("clear", {}); } catch (e) {} }
  }, { selected: true });
  state.menuItem = toggle;
  menu.addItem(toggle);
  menu.addItem(menu.item("Save EN .srt now", function () { saveSrtNow(true); }));
  menu.addItem(menu.item("Diagnose JA→EN", function () {
    var summary;
    var info = null;
    try {
      try { ensureBins(); } catch (e) {} // resolve fresh even when idle
      info = gatherDiag();
      var lines = diagReport(info);
      for (var i = 0; i < lines.length; i++) {
        blog(lines[i]);
      }
      summary = diagSummary(info);
    } catch (e) {
      summary = "diagnose failed: " + (e && e.message);
    }
    try { core.osd("JA→EN: " + summary); } catch (e) {}
    blogErr("diagnose: " + summary);
    // Sticky copy on the video overlay — OSDs vanish too fast to read.
    // Reuse info when available (var hoists it out of the try above).
    try {
      if (typeof info !== "undefined" && info) overlay.postMessage("diag", { lines: diagReport(info) });
      else overlay.postMessage("diag", { lines: [summary] });
    } catch (e) {}
  }));

  blog("started (player " + state.playerTag + ")");
}

start();
