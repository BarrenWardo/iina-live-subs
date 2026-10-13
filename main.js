// JA→EN Live Subs — main entry (runs once per player window).
// All state below is per-player by design. Do not hoist across instances.
const { core, event, mpv, overlay, menu, preferences, file, utils, console } = iina;
const prefs = require("./lib/prefs.js");
const standby = require("./lib/standby.js");

var state = {
  enabled: true,
  busy: false,
  lastPos: null,
  timer: null,
  segCounter: 0,
  srtLines: [],
  osdCount: {},
  playerTag: Math.random().toString(36).slice(2, 8),
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
  var reason;
  try {
    reason = standby.check(core.status, core.subtitle.tracks, {
      standbyWhenEnSubs: pref("standbyWhenEnSubs", true),
    });
  } catch (e) {
    return null;
  }
  return reason;
}

function resetForNewFile(url) {
  state.busy = false;
  state.lastPos = null;
  state.segCounter = 0;
  state.srtLines = [];
  try { overlay.postMessage("clear", {}); } catch (e) {}
  console.log("ja-en-subs: new file: " + url);
}

function tick() {
  if (state.busy) return;
  var reason = standbyReason();
  if (reason) return;
  if (core.status.paused) return;
  var pos = core.status.position;
  if (pos === null || pos === undefined) return;
  if (state.lastPos !== null && Math.abs(pos - state.lastPos) > 1.5) {
    // Seek discontinuity: flush and restart window.
    try { overlay.postMessage("clear", {}); } catch (e) {}
  }
  state.lastPos = pos;
  // TODO(plan): slice window [pos+0.2, pos+chunk]/speed via ffmpeg,
  // translate via whisper-cpp --translate, dedup overlap, postMessage("subs").
  // Engine binaries not bundled yet — v0.1.0 only wires lifecycle + standby.
  console.log("ja-en-subs: tick at " + pos.toFixed(1) + "s (engine TODO)");
}

function start() {
  try { overlay.loadFile("overlay/subs.html"); } catch (e) {}
  try { overlay.show(); } catch (e) {}
  event.on("iina.file-loaded", function (url) { resetForNewFile(url); });
  event.on("iina.window-will-close", function () {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    try { overlay.postMessage("clear", {}); } catch (e) {}
  });
  event.on("mpv.time-pos.changed", function () { tick(); });
  state.timer = setInterval(tick, 2000);

  var toggle = menu.item("JA→EN Subs: On", function (item) {
    var on = !pref("enabled", true);
    preferences.set("enabled", on);
    item.title = on ? "JA→EN Subs: On" : "JA→EN Subs: Off";
    menu.forceUpdate();
    if (!on) { try { overlay.postMessage("clear", {}); } catch (e) {} }
  }, { selected: true });
  menu.addItem(toggle);

  console.log("ja-en-subs: started (player " + state.playerTag + ")");
}

start();
