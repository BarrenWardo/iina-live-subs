var diag = require("../lib/diag");

test("diag: report lines contain key fields", function () {
  var lines = diag.formatReport({
    url: "https://x/y", isStream: true, streamOk: true,
    ffmpeg: "bin/ffmpeg", whisper: null, model: null,
    idle: false, paused: false, pos: 12.5, speed: 1,
    standby: "null", subTracks: 0, audioTracks: 1,
    busy: false, fails: 0, pausedLoop: false, segs: 3,
    lang: "auto", modelPref: "tiny", chunk: 5,
  });
  var all = lines.join("\n");
  assert.ok(all.indexOf("whisper=null") !== -1);
  assert.ok(all.indexOf("segs=3") !== -1);
});

test("diag: summary names the blocker", function () {
  assert.strictEqual(diag.shortSummary({ standby: "buffering" }), "standby: buffering");
  assert.strictEqual(diag.shortSummary({ standby: "null", ffmpeg: null }), "setup needed");
  assert.strictEqual(
    diag.shortSummary({ standby: "null", ffmpeg: "f", whisper: "w", model: "m", pausedLoop: true }),
    "paused after slice fails"
  );
  assert.strictEqual(
    diag.shortSummary({ standby: "null", ffmpeg: "f", whisper: "w", model: "m", segs: 7 }),
    "7 segments so far"
  );
});
