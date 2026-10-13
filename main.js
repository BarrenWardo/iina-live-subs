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

var state = {
  enabled: true,
  timer: null,
  segCounter: 0,
  osdCount: {},
  playerTag: Math.random().toString(36).slice(2, 8),
  loop: loop.createState(),
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
    return standby.check(core.status, core.subtitle.tracks, {
      standbyWhenEnSubs: pref("standbyWhenEnSubs", true),
    });
  } catch (e) {
    return null;
  }
}

// Binary/model readiness (spec §3). Existence check doubles as PATH check
// via utils.fileInPath. Ruling: relative "bin/…" base semantics confirmed
// at first IINA run (README drill); universal2 builds preferred.
function existsBoth(p) {
  try {
    if (file.exists(p)) return true;
  } catch (e) {}
  try {
    if (utils.fileInPath(p)) return true;
  } catch (e) {}
  return false;
}

function refreshMenu() {
  if (!state.menuItem) return;
  var st = setup.setupState({
    ffmpeg: state.bins && state.bins.ffmpeg,
    whisper: state.bins && state.bins.whisper,
    model: state.bins && state.bins.model,
  });
  var on = pref("enabled", true);
  state.menuItem.title = st === "ready"
    ? (on ? "JA→EN Subs: On" : "JA→EN Subs: Off")
    : "JA→EN Subs: Setup needed";
  try { menu.forceUpdate(); } catch (e) {}
}

function ensureBins() {
  if (state.bins && state.bins.ffmpeg && state.bins.whisper && state.bins.model) return state.bins;
  var ffmpeg = setup.pickBin(existsBoth, "ffmpeg", true);
  var whisper = setup.pickBin(existsBoth, "whisper-cpp", false);
  var model = null;
  var modelWant = null;
  try {
    modelWant = engine.modelPath(utils.resolvePath("@data/models"), pref("model", "tiny"));
    if (file.exists(modelWant)) model = modelWant;
  } catch (e) {}
  state.bins = { ffmpeg: ffmpeg, whisper: whisper, model: model };
  var st = setup.setupState(state.bins);
  if (st === "need-model" && modelWant && !state.modelDl) {
    state.modelDl = true;
    try {
      var http = iina.http;
      setup.ensureModel(
        function (url, dest) { return http.download(url, dest); },
        function (p) { return file.exists(p); },
        utils.resolvePath("@data/models"),
        pref("model", "tiny")
      ).then(function (p) {
        state.modelDl = false;
        if (p) {
          state.bins.model = p;
          osdOncePerMin("setup", "JA→EN: model ready");
        }
        refreshMenu();
      });
      osdOncePerMin("setup", "JA→EN: downloading speech model (once)…");
    } catch (e) {
      state.modelDl = false;
    }
  } else if (st !== "ready") {
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
    getChunk: function () { return pref("chunkSecs", 5); },
    getSpeed: function () { return core.status.speed || 1; },
    tmpPath: tmpWav,
    slice: function (wav, start, len) {
      var bins = ensureBins();
      if (!bins) return Promise.resolve(1);
      var src = state.isStream ? state.streamUrl : state.url;
      var audioIdx = null;
      try {
        audioIdx = slicer.pickAudioIdx(core.audio.tracks);
      } catch (e) {}
      var args = slicer.buildSliceArgs(src, audioIdx, start, len);
      return slicer.slice(function (b, a) { return utils.exec(b, a); }, bins.ffmpeg, args, wav);
    },
    transcribe: function (wav) {
      var bins = ensureBins();
      if (!bins) return Promise.resolve([]);
      var lang = pref("sourceLang", "auto");
      return utils.exec(bins.whisper, engine.buildWhisperArgs(bins.model, wav, lang)).then(function (res) {
        if (res.status !== 0) {
          try { console.error("ja-en-subs: whisper exit " + res.status + ": " + String(res.stderr).slice(-300)); } catch (e) {}
          return [];
        }
        return engine.parseWhisperJson(res.stdout);
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

function resetForNewFile(url) {
  state.loop = loop.createState();
  state.bins = null;
  state.modelDl = false;
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
      osdOncePerMin("stream", "JA→EN: this stream type is unsupported — standby");
    }
  }
  try { overlay.postMessage("clear", {}); } catch (e) {}
  try { console.log("ja-en-subs: new file: " + url + (state.isStream ? " (stream)" : "")); } catch (e) {}
}

function tick() {
  loop.tick(state.loop, makeCtx()).then(function (r) {
    if (r !== "ok" && r !== "busy" && r.indexOf("standby") !== 0 && r !== "paused") {
      try { console.log("ja-en-subs: tick -> " + r + " (" + phrase(state.loop.cumSegs.length) + ")"); } catch (e) {}
    }
  });
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

  try { console.log("ja-en-subs: started (player " + state.playerTag + ")"); } catch (e) {}
}

start();
