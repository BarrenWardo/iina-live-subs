var setup = require("../lib/setup");

function existsFn(existing) {
  return function (p) { return existing.indexOf(p) !== -1; };
}

test("setup: universal binary preferred", function () {
  var p = setup.pickBin(existsFn(["bin/ffmpeg", "bin/ffmpeg-arm64"]), "ffmpeg", false);
  assert.strictEqual(p, "bin/ffmpeg");
});

test("setup: arm64 before x64", function () {
  var p = setup.pickBin(existsFn(["bin/whisper-cpp-arm64", "bin/whisper-cpp-x64"]), "whisper-cpp", false);
  assert.strictEqual(p, "bin/whisper-cpp-arm64");
});

test("setup: none existing -> null", function () {
  assert.strictEqual(setup.pickBin(existsFn([]), "whisper-cpp", false), null);
});

test("setup: ffmpeg PATH fallback", function () {
  var p = setup.pickBin(existsFn(["ffmpeg"]), "ffmpeg", true);
  assert.strictEqual(p, "ffmpeg");
});

test("setup: no PATH fallback for whisper", function () {
  assert.strictEqual(setup.pickBin(existsFn(["whisper-cpp"]), "whisper-cpp", true), null);
});

test("setup: model exists short-circuits (no download)", function () {
  var downloaded = [];
  return setup.ensureModel(
    function () { downloaded.push(1); return Promise.resolve(); },
    existsFn(["/data/ggml-tiny.bin"]),
    "/data", "tiny"
  ).then(function (p) {
    assert.strictEqual(p, "/data/ggml-tiny.bin");
    assert.strictEqual(downloaded.length, 0);
  });
});

test("setup: missing model downloads then resolves", function () {
  var present = [];
  var got = [];
  return setup.ensureModel(
    function (url, dest) { got.push([url, dest]); present.push(dest); return Promise.resolve(); },
    function (p) { return present.indexOf(p) !== -1; },
    "/data", "base"
  ).then(function (p) {
    assert.strictEqual(p, "/data/ggml-base.bin");
    assert.strictEqual(got.length, 1);
    assert.ok(got[0][0].indexOf("ggml-base.bin") !== -1);
  });
});

test("setup: failed download -> null", function () {
  return setup.ensureModel(
    function () { return Promise.reject(new Error("offline")); },
    existsFn([]),
    "/data", "tiny"
  ).then(function (p) {
    assert.strictEqual(p, null);
  });
});

test("setup: setupState matrix", function () {
  assert.strictEqual(setup.setupState({ ffmpeg: "f", whisper: "w", model: "m" }), "ready");
  assert.strictEqual(setup.setupState({ ffmpeg: null, whisper: "w", model: "m" }), "need-bin");
  assert.strictEqual(setup.setupState({ ffmpeg: "f", whisper: null, model: "m" }), "need-bin");
  assert.strictEqual(setup.setupState({ ffmpeg: "f", whisper: "w", model: null }), "need-model");
});
