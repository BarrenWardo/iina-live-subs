// Per-player transcription loop core (spec §4-5). Injected ctx keeps this
// node-testable; main.js wires real iina modules. All paths reset busy.
var subs = require("./subs");

function createState() {
  return {
    busy: false,
    winId: 0,
    lastPos: null,
    fails: 0,
    pausedLoop: false,
    lastText: "",
    cumSegs: [],
    tmpFiles: [],
  };
}

// Immediate seek signal (e.g. mpv seek event): invalidate any flight.
function notifySeek(st, ctx) {
  st.winId += 1;
  st.lastText = "";
  try {
    ctx.postClear();
  } catch (e) {}
}

function tick(st, ctx) {
  if (st.busy) return Promise.resolve("busy");
  if (st.pausedLoop) return Promise.resolve("paused-loop");
  var reason = ctx.standbyCheck();
  if (reason) return Promise.resolve("standby:" + reason);
  if (ctx.isPaused()) return Promise.resolve("paused");
  var pos = ctx.getPos();
  if (pos === null || pos === undefined) return Promise.resolve("no-pos");

  if (st.lastPos !== null && Math.abs(pos - st.lastPos) > 1.5) {
    st.winId += 1;
    st.lastText = "";
    try {
      ctx.postClear();
    } catch (e) {}
  }
  st.lastPos = pos;

  var myId = ++st.winId;
  st.busy = true;
  var len = ctx.getChunk() / ctx.getSpeed();
  var start = pos + 0.2;
  var wav = ctx.tmpPath();

  function done(result) {
    // Only one tick runs at a time (single-flight); a mismatched winId
    // means notifySeek fired mid-flight, and this completion is stale.
    st.busy = false;
    return result;
  }

  return ctx.slice(wav, start, len).then(function (status) {
    if (myId !== st.winId) return done("stale");
    if (status !== 0) {
      st.fails += 1;
      if (st.fails >= 3) {
        st.pausedLoop = true;
        try {
          ctx.osd("JA→EN: audio slice failed — paused");
        } catch (e) {}
        return done("paused-loop");
      }
      return done("slice-fail");
    }
    st.fails = 0;
    return ctx.transcribe(wav).then(function (segs) {
      if (myId !== st.winId) return done("stale");
      var fresh = subs.dedupe(st.lastText, segs || []);
      var clocked = subs.toClock(fresh, start);
      if (clocked.length > 0) {
        var last = clocked[clocked.length - 1];
        st.lastText = last.text;
        st.cumSegs = st.cumSegs.concat(clocked);
        ctx.postSubs({ text: last.text, t0: last.t0, t1: last.t1 });
      }
      st.tmpFiles.push(wav);
      while (st.tmpFiles.length > 4) {
        var old = st.tmpFiles.shift();
        try {
          ctx.removeTmp(old);
        } catch (e) {}
      }
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
  tick: tick,
};
