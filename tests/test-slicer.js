var slicer = require("../lib/slicer");

test("slicer: -ss precedes -i (fast seek)", function () {
  var args = slicer.buildSliceArgs("file.mkv", 0, 12.5, 5);
  assert.ok(args.indexOf("-ss") !== -1 && args.indexOf("-i") !== -1);
  assert.ok(args.indexOf("-ss") < args.indexOf("-i"));
});

test("slicer: mono 16k wav flags present", function () {
  var args = slicer.buildSliceArgs("file.mkv", 0, 0, 5);
  assert.ok(args.indexOf("-ar") !== -1 && args[args.indexOf("-ar") + 1] === "16000");
  assert.ok(args.indexOf("-ac") !== -1 && args[args.indexOf("-ac") + 1] === "1");
  assert.ok(args.indexOf("-f") !== -1 && args[args.indexOf("-f") + 1] === "wav");
});

test("slicer: maps selected audio track", function () {
  var args = slicer.buildSliceArgs("file.mkv", 2, 0, 5);
  assert.ok(args.indexOf("0:a:2") !== -1);
});

test("slicer: start/len values embedded", function () {
  var args = slicer.buildSliceArgs("file.mkv", 0, 12.5, 5);
  assert.strictEqual(args[args.indexOf("-ss") + 1], "12.5");
  assert.strictEqual(args[args.indexOf("-t") + 1], "5");
});

test("slicer: pickAudioIdx returns selected track id", function () {
  var idx = slicer.pickAudioIdx([{ id: 1, isSelected: false }, { id: 2, isSelected: true }]);
  assert.strictEqual(idx, 2);
});

test("slicer: pickAudioIdx empty -> null", function () {
  assert.strictEqual(slicer.pickAudioIdx([]), null);
});

test("slicer: pickAudioIdx none selected -> null", function () {
  assert.strictEqual(slicer.pickAudioIdx([{ id: 1, isSelected: false }]), null);
});

test("slicer: audioPseudo builds pseudo path", function () {
  assert.strictEqual(slicer.audioPseudo(2), "@audio/2");
});

test("slicer: slice resolves exit status", function () {
  var calls = [];
  function fakeExec(bin, args) {
    calls.push([bin, args]);
    return Promise.resolve({ status: 0, stdout: "", stderr: "" });
  }
  return slicer.slice(fakeExec, "ffmpeg", ["-x"], "@tmp/a.wav").then(function (st) {
    assert.strictEqual(st, 0);
    assert.strictEqual(calls[0][0], "ffmpeg");
  });
});

test("slicer: slice propagates nonzero status", function () {
  function fakeExec() {
    return Promise.resolve({ status: 1, stdout: "", stderr: "boom" });
  }
  return slicer.slice(fakeExec, "ffmpeg", [], "@tmp/a.wav").then(function (st) {
    assert.strictEqual(st, 1);
  });
});
