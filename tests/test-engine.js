var fs = require("fs");
var engine = require("../lib/engine");

test("engine: args contain --translate and -l ja", function () {
  var args = engine.buildWhisperArgs("/m/ggml-tiny.bin", "/t/a.wav", "ja");
  assert.ok(args.indexOf("--translate") !== -1);
  assert.strictEqual(args[args.indexOf("-l") + 1], "ja");
  assert.ok(args.indexOf("--output-json") !== -1 || args.indexOf("-oj") !== -1);
});

test("engine: lang auto passes through", function () {
  var args = engine.buildWhisperArgs("/m/x.bin", "/t/a.wav", "auto");
  assert.strictEqual(args[args.indexOf("-l") + 1], "auto");
});

test("engine: args reference model and wav", function () {
  var args = engine.buildWhisperArgs("/m/ggml-tiny.bin", "/t/a.wav", "ja");
  assert.ok(args.indexOf("/m/ggml-tiny.bin") !== -1);
  assert.ok(args.indexOf("/t/a.wav") !== -1);
});

test("engine: modelPath joins dir and name", function () {
  assert.strictEqual(engine.modelPath("/data/models", "tiny"), "/data/models/ggml-tiny.bin");
});

test("engine: fixture parses, trims, drops empties", function () {
  var raw = fs.readFileSync(__dirname + "/fixtures/whisper-sample.json", "utf8");
  var segs = engine.parseWhisperJson(raw);
  assert.strictEqual(segs.length, 2);
  assert.strictEqual(segs[0].text, "Good morning.");
  assert.strictEqual(segs[0].t0, 1);
  assert.strictEqual(segs[0].t1, 3.5);
  assert.strictEqual(segs[1].t0, 6);
  assert.strictEqual(segs[1].t1, 7.25);
});

test("engine: corrupt stdout -> []", function () {
  assert.deepStrictEqual(engine.parseWhisperJson("not json {{{"), []);
});

test("engine: empty stdout -> []", function () {
  assert.deepStrictEqual(engine.parseWhisperJson(""), []);
  assert.deepStrictEqual(engine.parseWhisperJson("   "), []);
});

test("engine: missing transcription key -> []", function () {
  assert.deepStrictEqual(engine.parseWhisperJson('{"x":1}'), []);
});
