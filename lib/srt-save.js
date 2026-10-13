// Save-SRT helpers (spec §5 long-video rule + Task 8).
var FLUSH_MS = 5 * 60 * 1000;

function shouldFlush(lastFlush, now) {
  return now - lastFlush >= FLUSH_MS;
}

function srtPathFor(title) {
  var base = String(title || "").replace(/[^a-zA-Z0-9-_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!base) base = "untitled";
  // .en suffix: mpv/IINA reads track language (and a title) from the
  // filename for external subs. Without it the UI shows "unknown".
  return "@data/subs/" + base.slice(0, 80) + ".en.srt";
}

module.exports = {
  shouldFlush: shouldFlush,
  srtPathFor: srtPathFor,
  FLUSH_MS: FLUSH_MS,
};
