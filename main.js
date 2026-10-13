// JA→EN Live Subs — main entry (runs once per player window).
// All state below is per-player by design. Do not hoist across instances.
const { core, event, mpv, overlay, menu, preferences, file, utils, console } = iina;
const prefs = require("./lib/prefs.js");
const standby = require("./lib/standby.js");
const slicer = require("./lib/slicer.js");
const engine = require("./lib/engine.js");
const loop = require("./lib/loop.js");

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
  try {
    return standby.check(core.status, core.subtitle.tracks, {
      standbyWhenEnSubs: pref("standbyWhenEnSubs", true),
    });
  } catch (e) {
    return null;
  }
}

// Task 7 will promote this to lib/setup.js with arch select + download.
// v1: first hit wins across universal/arm64/x64 names + PATH fallback.
function resolveBin(name) {
  var candidates = [name, name + "-arm64", name + "-x64"];
  for (var i = 0; i < candidates.length; i++) {
    try {
      if (utils.fileInPath(candidates[i])) return candidates[i];
    } catch (e) {}
  }
  return null;
}

function ensureBins() {
  if (state.bins) return state.bins;
  var ffmpeg = resolveBin("bin/ffmpeg") || (utils.fileInPath("ffmpeg") ? "ffmpeg" : null);
  var whisper = resolveBin("bin/whisper-cpp");
  var model = null;
  if (whisper) {
    try {
      var p = engine.modelPath(utils.resolvePath("@data/models"), pref("model", "tiny"));
      if (file.exists(p)) model = p;
    } catch (e) {}
  }
  if (!ffmpeg || !whisper || !model) {
    osdOncePerMin("setup", "JA→EN: setup needed (binaries/model) — see README");
    try { console.error("ja-en-subs: missing " + (!ffmpeg ? "ffmpeg " : "") + (!whisper ? "whisper " : "") + (!model ? "model" : "")); } catch (e) {}
    return null;
  }
  state.bins = { ffmpeg: ffmpeg, whisper: whisper, model: model };
  return state.bins;
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
      var src = state.url;
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
  state.segCounter = 0;
  state.url = url;
  try {
    state.isStream = core.status.isNetworkResource;
  } catch (e) {
    state.isStream = false;
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
    item.title = on ? "JA→EN Subs: On" : "JA→EN Subs: Off";
    menu.forceUpdate();
    if (!on) { try { overlay.postMessage("clear", {}); } catch (e) {} }
  }, { selected: true });
  menu.addItem(toggle);

  try { console.log("ja-en-subs: started (player " + state.playerTag + ")"); } catch (e) {}
}

start();
