// Per-player transcription loop core (spec §4-5). Injected ctx keeps this
// node-testable; main.js wires real iina modules. All paths reset busy.
var subs = require("./subs");

var PAUSE_MS = 60000;
var MAX_CUM = 5000;
var MIN_CHUNK = 2;
var MAX_CHUNK = 10;
var MAX_LEN = 12;
var OVERLAP = 0.5;

function createState() {
  return {
    busy: false,
    winId: 0,
    lastPos: null,
    winEnd: null,
    fails: 0,
    slowArmed: false,
    pausedLoop: false,
    pauseUntil: 0,
    lastText: "",
    cumSegs: [],
    tmpFiles: [],
  };
}

// Immediate seek signal (e.g. mpv seek event): invalidate any flight.
function notifySeek(st, ctx) {
  st.winId += 1;
  st.lastText = "";
  st.winEnd = null;
  try {
    ctx.postClear();
  } catch (e) {}
}

function appendCapped(arr, items, cap) {
  var out = arr.concat(items);
  while (out.length > cap) out.shift();
  return out;
}

function cleanup(st, ctx, wav) {
  try {
    ctx.removeTmp(wav);
  } catch (e) {}
}

function tick(st, ctx) {
  if (st.busy) return Promise.resolve("busy");
  if (st.pausedLoop) {
    var now = ctx.now();
    if (now < st.pauseUntil) return Promise.resolve("paused-loop");
    st.pausedLoop = false;
    st.fails = 0;
    st.slowArmed = false;
  }
  var reason = ctx.standbyCheck();
  if (reason) return Promise.resolve("standby:" + reason);
  if (ctx.isPaused()) return Promise.resolve("paused");
  var pos = ctx.getPos();
  if (pos === null || pos === undefined) return Promise.resolve("no-pos");

  if (st.lastPos !== null && Math.abs(pos - st.lastPos) > 1.5) {
    st.winId += 1;
    st.lastText = "";
    st.winEnd = null;
    try {
      ctx.postClear();
    } catch (e) {}
  }
  st.lastPos = pos;

  var myId = ++st.winId;
  st.busy = true;
  var chunk = ctx.getChunk();
  if (!(chunk >= MIN_CHUNK)) chunk = MIN_CHUNK;
  if (chunk > MAX_CHUNK) chunk = MAX_CHUNK;
  var speed = ctx.getSpeed() || 1;
  if (!(speed > 0)) speed = 1;
  var len = chunk / speed;
  if (len > MAX_LEN) len = MAX_LEN;
  // Continue from the previous window with a small overlap instead of
  // rechunking from the live edge (saves ~2-3x whisper work).
  var start = pos + 0.2;
  if (st.winEnd !== null && st.winEnd - OVERLAP > start) start = st.winEnd - OVERLAP;
  var wav = ctx.tmpPath();

  function done(result) {
    st.busy = false;
    return result;
  }

  return ctx.slice(wav, start, len, st.slowArmed).then(function (status) {
    if (status === "not-ready") return done("not-ready");
    if (myId !== st.winId) {
      cleanup(st, ctx, wav);
      return done("stale");
    }
    if (status !== 0) {
      cleanup(st, ctx, wav);
      if (!st.slowArmed) {
        // First failure: retry next window with slow seek, no strike.
        st.slowArmed = true;
        return done("slice-retry");
      }
      st.fails += 1;
      if (st.fails >= 3) {
        st.pausedLoop = true;
        st.pauseUntil = ctx.now() + PAUSE_MS;
        try {
          ctx.osd("JA→EN: audio slice failed — paused");
        } catch (e) {}
        return done("paused-loop");
      }
      return done("slice-fail");
    }
    st.fails = 0;
    return ctx.transcribe(wav).then(function (segs) {
      if (myId !== st.winId) {
        cleanup(st, ctx, wav);
        return done("stale");
      }
      var fresh = subs.dedupe(st.lastText, segs || []);
      var clocked = subs.toClock(fresh, start);
      if (clocked.length > 0) {
        var last = clocked[clocked.length - 1];
        st.lastText = last.text;
        st.cumSegs = appendCapped(st.cumSegs, clocked, MAX_CUM);
        ctx.postSubs({ text: last.text, t0: last.t0, t1: last.t1 });
      }
      st.tmpFiles.push(wav);
      while (st.tmpFiles.length > 4) {
        var old = st.tmpFiles.shift();
        try {
          ctx.removeTmp(old);
        } catch (e) {}
      }
      st.winEnd = start + len;
      return done("ok");
    });
  }).then(function (r) {
    return r;
  }, function () {
    st.busy = false;
    return "error";
  });
}

module.exports = {
  createState: createState,
  notifySeek: notifySeek,
  appendCapped: appendCapped,
  tick: tick,
  PAUSE_MS: PAUSE_MS,
  MAX_CUM: MAX_CUM,
};
