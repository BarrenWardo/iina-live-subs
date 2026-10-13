var subs = require("../lib/subs");

test("subs: overlapping prefix head dropped", function () {
  var segs = [
    { t0: 0, t1: 1, text: "Good morning everyone" },
    { t0: 1, t1: 2, text: "How are you?" },
  ];
  var out = subs.dedupe("Good morning", segs);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].text, "How are you?");
});

test("subs: exact repeat dropped", function () {
  var segs = [{ t0: 0, t1: 1, text: "Hello" }];
  assert.deepStrictEqual(subs.dedupe("Hello", segs), []);
});

test("subs: empty tail keeps all", function () {
  var segs = [{ t0: 0, t1: 1, text: "Hello" }];
  assert.strictEqual(subs.dedupe("", segs).length, 1);
});

test("subs: clock offset added", function () {
  var out = subs.toClock([{ t0: 1, t1: 3.5, text: "Hi" }], 100.5);
  assert.strictEqual(out[0].t0, 101.5);
  assert.strictEqual(out[0].t1, 104);
  assert.strictEqual(out[0].text, "Hi");
});

test("subs: srt exact format", function () {
  var srt = subs.toSrt([
    { t0: 61.5, t1: 63.25, text: "Hello" },
    { t0: 65, t1: 3661.007, text: "Bye" },
  ]);
  var expected = "1\n00:01:01,500 --> 00:01:03,250\nHello\n\n" +
    "2\n00:01:05,000 --> 01:01:01,007\nBye\n\n";
  assert.strictEqual(srt, expected);
});

test("subs: empty input -> empty string", function () {
  assert.strictEqual(subs.toSrt([]), "");
});

test("subs: flushSrt calls file write", function () {
  var calls = [];
  subs.flushSrt(function (p, c) { calls.push([p, c]); }, "@data/x.srt", "BODY");
  assert.deepStrictEqual(calls, [["@data/x.srt", "BODY"]]);
});
