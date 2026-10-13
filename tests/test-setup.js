var setup = require("../lib/setup");

function existsFn(existing) {
  return function (p) { return existing.indexOf(p) !== -1; };
}

test("setup: binPath joins data dir", function () {
  assert.strictEqual(setup.binPath("/data", "ffmpeg"), "/data/bin/ffmpeg");
});

test("setup: binAssetUrl uses pinned stable tag", function () {
  var u = setup.binAssetUrl("whisper-cpp-arm64");
  assert.ok(u.indexOf("releases/download/assets-v1/whisper-cpp-arm64") !== -1);
});

test("setup: existing bin short-circuits (no download)", function () {
  var downloaded = [];
  return setup.ensureBin(
    function () { downloaded.push(1); return Promise.resolve(); },
    existsFn(["/data/bin/ffmpeg"]),
    "/data", "ffmpeg", "https://x/ffmpeg"
  ).then(function (p) {
    assert.strictEqual(p, "/data/bin/ffmpeg");
    assert.strictEqual(downloaded.length, 0);
  });
});

test("setup: missing bin downloads then resolves", function () {
  var present = [];
  var got = [];
  return setup.ensureBin(
    function (url, dest) { got.push([url, dest]); present.push(dest); return Promise.resolve(); },
    function (p) { return present.indexOf(p) !== -1; },
    "/data", "whisper-cpp-arm64", "https://x/whisper-cpp-arm64"
  ).then(function (p) {
    assert.strictEqual(p, "/data/bin/whisper-cpp-arm64");
    assert.strictEqual(got[0][0], "https://x/whisper-cpp-arm64");
  });
});

test("setup: failed bin download -> null", function () {
  return setup.ensureBin(
    function () { return Promise.reject(new Error("offline")); },
    existsFn([]),
    "/data", "ffmpeg", "https://x/ffmpeg"
  ).then(function (p) {
    assert.strictEqual(p, null);
  });
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
