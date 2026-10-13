// Subtitle pipeline: overlap dedup, playback-clock mapping, SRT export.
function dedupe(prevTail, segs) {
  if (!prevTail) return segs.slice();
  var out = segs.slice();
  while (out.length > 0 && out[0].text.indexOf(prevTail) === 0) {
    out.shift();
  }
  return out;
}

function toClock(segs, basePos) {
  return segs.map(function (s) {
    return { t0: s.t0 + basePos, t1: s.t1 + basePos, text: s.text };
  });
}

function pad(n, w) {
  var s = String(n);
  while (s.length < w) s = "0" + s;
  return s;
}

function fmt(t) {
  var h = Math.floor(t / 3600);
  var m = Math.floor((t % 3600) / 60);
  var sec = Math.floor(t % 60);
  var ms = Math.round((t - Math.floor(t)) * 1000);
  return pad(h, 2) + ":" + pad(m, 2) + ":" + pad(sec, 2) + "," + pad(ms, 3);
}

function toSrt(cumSegs) {
  var out = "";
  for (var i = 0; i < cumSegs.length; i++) {
    var s = cumSegs[i];
    out += (i + 1) + "\n" + fmt(s.t0) + " --> " + fmt(s.t1) + "\n" + s.text + "\n\n";
  }
  return out;
}

// fileWrite: file.write-shaped (path, content).
function flushSrt(fileWrite, path, srtText) {
  fileWrite(path, srtText);
}

module.exports = {
  dedupe: dedupe,
  toClock: toClock,
  toSrt: toSrt,
  flushSrt: flushSrt,
};
