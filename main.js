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
const diag = require("./lib/diag.js");
const subs = require("./lib/subs.js");
const srtsave = require("./lib/srt-save.js");

var state = {
  enabled: true,
  timer: null,
  segCounter: 0,
  osdCount: {},
  playerTag: Math.random().toString(36).slice(2, 8),
  loop: loop.createState(),
  lastFlush: 0,
  dl: {},
  bins: null, // {ffmpeg, whisper, model} resolved per file
  url: null,
  isStream: false,
};

function pref(key, fallback) {
  return prefs.get(key, fallback);
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
  try {
    return utils.resolvePath("@data");
  } catch (e) {
    return null;
  }
}

function queueDownload(kind, url, dest) {
  if (state.dl[kind]) return;
  state.dl[kind] = true;
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
  if (state.dl.ffmpeg || state.dl.whisper || state.dl.model) return null;
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
  var st = setup.setupState(state.bins);
  if (st !== "ready" && !needDl) {
    osdOncePerMin("setup", "JA→EN: setup needed (binaries/model) — see README");
    try { console.error("ja-en-subs: setup state " + st); } catch (e) {}
  }
  refreshMenu();
  return st === "ready" ? state.bins : null;
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
          try { console.error("ja-en-subs: whisper exit " + res.status + ": " + String(res.stderr).slice(-300)); } catch (e) {}
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
  try { console.log("ja-en-subs: new file: " + safeUrlLog(url) + (state.isStream ? " (stream)" : "")); } catch (e) {}
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
    try { console.error("ja-en-subs: tick threw: " + (e && e.message)); } catch (e2) {}
    return;
  }
  p.then(function (r) {
    // Log terminal/standby transitions (not every tick): silence is why
    // "no subs" was undebuggable.
    var quiet = (r === "ok" || r === "busy");
    if (r !== state.lastResult && !quiet) {
      try { console.log("ja-en-subs: state -> " + r); } catch (e) {}
    }
    state.lastResult = r;
    if (!quiet && r !== "paused") {
      try { console.log("ja-en-subs: tick -> " + r + " (" + phrase(state.loop.cumSegs.length) + ")"); } catch (e) {}
    }
    if (r === "ok" && pref("saveSrt", false) && srtsave.shouldFlush(state.lastFlush, Date.now())) {
      saveSrtNow(false);
    }
  }, function (e) {
    try { console.error("ja-en-subs: tick rejected: " + (e && e.message)); } catch (e2) {}
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
  return {
    url: safeUrlLog(state.url),
    isStream: safeGet(function () { return !!state.isStream; }, false),
    streamOk: !!state.streamOk,
    ffmpeg: bins.ffmpeg || null,
    whisper: bins.whisper || null,
    model: bins.model || null,
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
    try {
      var info = gatherDiag();
      var lines = diag.formatReport(info);
      for (var i = 0; i < lines.length; i++) {
        try { console.log("ja-en-subs: " + lines[i]); } catch (e) {}
      }
      summary = diag.shortSummary(info);
    } catch (e) {
      summary = "diagnose failed: " + (e && e.message);
    }
    try { core.osd("JA→EN: " + summary); } catch (e) {}
    try { console.error("ja-en-subs: diagnose: " + summary); } catch (e) {}
  }));

  try { console.log("ja-en-subs: started (player " + state.playerTag + ")"); } catch (e) {}
}

start();
