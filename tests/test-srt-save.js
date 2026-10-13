var srtsave = require("../lib/srt-save");

test("srt-save: flush due after 5 min", function () {
  assert.strictEqual(srtsave.shouldFlush(0, 5 * 60 * 1000), true);
  assert.strictEqual(srtsave.shouldFlush(0, 5 * 60 * 1000 - 1), false);
});

test("srt-save: title sanitized to filename", function () {
  assert.strictEqual(
    srtsave.srtPathFor("My Anime: Ep/01 — test"),
    "@data/subs/My_Anime_Ep_01_test.srt"
  );
});

test("srt-save: empty title falls back", function () {
  assert.strictEqual(srtsave.srtPathFor(""), "@data/subs/untitled.srt");
  assert.strictEqual(srtsave.srtPathFor(null), "@data/subs/untitled.srt");
});
