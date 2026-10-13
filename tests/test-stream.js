var stream = require("../lib/stream");

test("stream: direct mp4 sliceable", function () {
  assert.strictEqual(stream.isSliceable("https://cdn.example.com/vid.mp4"), true);
});

test("stream: hls m3u8 sliceable", function () {
  assert.strictEqual(stream.isSliceable("https://cdn.example.com/live.m3u8?tok=1"), true);
});

test("stream: mkv/webm sliceable", function () {
  assert.strictEqual(stream.isSliceable("https://cdn.example.com/a.mkv"), true);
  assert.strictEqual(stream.isSliceable("https://cdn.example.com/a.webm"), true);
});

test("stream: youtube watch page not sliceable", function () {
  assert.strictEqual(stream.isSliceable("https://www.youtube.com/watch?v=abc123"), false);
});

test("stream: youtu.be not sliceable", function () {
  assert.strictEqual(stream.isSliceable("https://youtu.be/abc123"), false);
});

test("stream: extensionless direct-download url is attempted", function () {
  assert.strictEqual(stream.isSliceable("https://dl-x01.mypikpak.com/download/?fid=abc&expire=1&sign=2"), true);
});

test("stream: bare path url is attempted (fail path handles misses)", function () {
  assert.strictEqual(stream.isSliceable("https://example.com/videos/42"), true);
});

test("stream: subdomain page blocked", function () {
  assert.strictEqual(stream.isSliceable("https://m.youtube.com/watch?v=x"), false);
});

test("stream: non-http url not attempted", function () {
  assert.strictEqual(stream.isSliceable("/local/file.mp4"), false);
});

test("stream: prefers resolved mpv url over page url", function () {
  function getString(name) {
    assert.strictEqual(name, "stream-open-filename");
    return "https://cdn.example.com/real.mp4";
  }
  assert.strictEqual(
    stream.resolveUrl("https://www.youtube.com/watch?v=abc", getString),
    "https://cdn.example.com/real.mp4"
  );
});

test("stream: falls back to status url when resolve fails", function () {
  function boom() { throw new Error("no mpv"); }
  assert.strictEqual(
    stream.resolveUrl("https://cdn.example.com/a.mp4", boom),
    "https://cdn.example.com/a.mp4"
  );
});

test("stream: empty resolve falls back to status url", function () {
  function empty() { return ""; }
  assert.strictEqual(
    stream.resolveUrl("https://cdn.example.com/a.mp4", empty),
    "https://cdn.example.com/a.mp4"
  );
});
