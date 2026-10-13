var loop = require("../lib/loop");

function makeCtx(over) {
  var ctx = {
    calls: [],
    standby: null,
    paused: false,
    pos: 10,
    chunk: 5,
    speed: 1,
    now: function () { return 0; },
    sliceResult: 0,
    segments: [{ t0: 0, t1: 2, text: "Hello" }],
    standbyCheck: function () { return ctx.standby; },
    isPaused: function () { return ctx.paused; },
    getPos: function () { return ctx.pos; },
    getChunk: function () { return ctx.chunk; },
    getSpeed: function () { return ctx.speed; },
    tmpPath: function () { return "@tmp/seg.wav"; },
    slice: function () { return Promise.resolve(ctx.sliceResult); },
    transcribe: function () { return Promise.resolve(ctx.segments); },
    postSubs: function (d) { ctx.calls.push(["subs", d]); },
    postClear: function () { ctx.calls.push(["clear"]); },
    osd: function (m) { ctx.calls.push(["osd", m]); },
    removeTmp: function () { ctx.calls.push(["rm"]); },
  };
  for (var k in over) ctx[k] = over[k];
  return ctx;
}

function kinds(ctx) {
  return ctx.calls.map(function (c) { return c[0]; });
}

test("loop: success posts latest line and resets busy", function () {
  var ctx = makeCtx({});
  var st = loop.createState();
  return loop.tick(st, ctx).then(function (r) {
    assert.strictEqual(r, "ok");
    assert.strictEqual(st.busy, false);
    assert.deepStrictEqual(kinds(ctx), ["subs"]);
    assert.strictEqual(ctx.calls[0][1].text, "Hello");
    assert.strictEqual(st.cumSegs.length, 1);
  });
});

test("loop: empty transcribe posts nothing, busy reset", function () {
  var ctx = makeCtx({ segments: [] });
  var st = loop.createState();
  return loop.tick(st, ctx).then(function (r) {
    assert.strictEqual(r, "ok");
    assert.strictEqual(st.busy, false);
    assert.deepStrictEqual(kinds(ctx), []);
  });
});

test("loop: standby short-circuits without work", function () {
  var ctx = makeCtx({ standby: "idle" });
  var st = loop.createState();
  return loop.tick(st, ctx).then(function (r) {
    assert.strictEqual(r, "standby:idle");
    assert.strictEqual(st.busy, false);
    assert.deepStrictEqual(kinds(ctx), []);
  });
});

test("loop: second tick while busy returns busy", function () {
  var resolvers = [];
  var ctx = makeCtx({
    transcribe: function () {
      return new Promise(function (res) { resolvers.push(res); });
    },
  });
  var st = loop.createState();
  var p1 = loop.tick(st, ctx);
  return loop.tick(st, ctx).then(function (r) {
    assert.strictEqual(r, "busy");
    resolvers[0]([]);
    return p1;
  }).then(function (r1) {
    assert.strictEqual(r1, "ok");
    assert.strictEqual(st.busy, false);
  });
});

test("loop: retry then three slow fails pause the loop + osd", function () {
  var ctx = makeCtx({ sliceResult: 1 });
  var st = loop.createState();
  return loop.tick(st, ctx).then(function (r) {
    assert.strictEqual(r, "slice-retry");
    return loop.tick(st, ctx);
  }).then(function () {
    return loop.tick(st, ctx);
  }).then(function () {
    return loop.tick(st, ctx);
  }).then(function (r) {
    assert.strictEqual(r, "paused-loop");
    assert.strictEqual(st.busy, false);
    assert.ok(kinds(ctx).indexOf("osd") !== -1);
  });
});

test("loop: seek during flight discards stale result", function () {
  var resolvers = [];
  var ctx = makeCtx({
    transcribe: function () {
      return new Promise(function (res) { resolvers.push(res); });
    },
  });
  var st = loop.createState();
  var p = loop.tick(st, ctx);
  assert.strictEqual(st.busy, true);
  return new Promise(function (res) { setTimeout(res, 0); }).then(function () {
    loop.notifySeek(st, ctx);
    resolvers[0]([{ t0: 0, t1: 1, text: "Stale" }]);
    return p;
  }).then(function (r) {
    assert.strictEqual(r, "stale");
    assert.strictEqual(st.busy, false);
    assert.ok(kinds(ctx).indexOf("subs") === -1);
    assert.ok(kinds(ctx).indexOf("clear") !== -1);
  });
});

test("loop: seek when idle clears and resets dedup tail", function () {
  var ctx = makeCtx({});
  var st = loop.createState();
  st.lastText = "Hello";
  loop.notifySeek(st, ctx);
  assert.strictEqual(st.lastText, "");
  assert.deepStrictEqual(kinds(ctx), ["clear"]);
});

test("loop: transcribe rejection resets busy", function () {
  var ctx = makeCtx({
    transcribe: function () { return Promise.reject(new Error("exec gone")); },
  });
  var st = loop.createState();
  return loop.tick(st, ctx).then(function (r) {
    assert.strictEqual(r, "error");
    assert.strictEqual(st.busy, false);
  });
});

test("loop: not-ready slice never counts strikes", function () {
  var ctx = makeCtx({
    slice: function () { return Promise.resolve("not-ready"); },
  });
  var st = loop.createState();
  return loop.tick(st, ctx).then(function () {
    return loop.tick(st, ctx);
  }).then(function () {
    return loop.tick(st, ctx);
  }).then(function (r) {
    assert.strictEqual(r, "not-ready");
    assert.strictEqual(st.fails, 0);
    assert.strictEqual(st.pausedLoop, false);
    assert.strictEqual(st.busy, false);
  });
});

test("loop: first fail arms slow retry without strike", function () {
  var seen = [];
  var ctx = makeCtx({
    slice: function (wav, start, len, slow) {
      seen.push(!!slow);
      return Promise.resolve(seen.length === 1 ? 1 : 0);
    },
  });
  var st = loop.createState();
  return loop.tick(st, ctx).then(function (r) {
    assert.strictEqual(r, "slice-retry");
    assert.strictEqual(st.fails, 0);
    return loop.tick(st, ctx);
  }).then(function (r) {
    assert.strictEqual(r, "ok");
    assert.deepStrictEqual(seen, [false, true]);
  });
});

test("loop: strikes count only in slow mode, then pause", function () {
  var ctx = makeCtx({
    slice: function () { return Promise.resolve(1); },
  });
  var st = loop.createState();
  return loop.tick(st, ctx).then(function (r) {
    assert.strictEqual(r, "slice-retry");
    return loop.tick(st, ctx);
  }).then(function () {
    return loop.tick(st, ctx);
  }).then(function () {
    return loop.tick(st, ctx);
  }).then(function (r) {
    assert.strictEqual(r, "paused-loop");
  });
});

test("loop: pause auto-resets after cooldown", function () {
  var now = 0;
  var ctx = makeCtx({
    now: function () { return now; },
    slice: function () { return Promise.resolve(ctx.sliceResult); },
  });
  ctx.sliceResult = 1;
  var st = loop.createState();
  // drive to pause: retry + 3 slow fails
  return loop.tick(st, ctx).then(function () { return loop.tick(st, ctx); })
    .then(function () { return loop.tick(st, ctx); })
    .then(function () { return loop.tick(st, ctx); })
    .then(function (r) {
      assert.strictEqual(r, "paused-loop");
      return loop.tick(st, ctx);
    }).then(function (r) {
      assert.strictEqual(r, "paused-loop"); // still cooling
      now += 61000;
      ctx.sliceResult = 0;
      return loop.tick(st, ctx);
    }).then(function (r) {
      assert.strictEqual(r, "ok");
      assert.strictEqual(st.pausedLoop, false);
    });
});

test("loop: stale flight removes its wav", function () {
  var resolvers = [];
  var ctx = makeCtx({
    transcribe: function () {
      return new Promise(function (res) { resolvers.push(res); });
    },
  });
  var st = loop.createState();
  var p = loop.tick(st, ctx);
  return new Promise(function (res) { setTimeout(res, 0); }).then(function () {
    loop.notifySeek(st, ctx);
    resolvers[0]([{ t0: 0, t1: 1, text: "Stale" }]);
    return p;
  }).then(function (r) {
    assert.strictEqual(r, "stale");
    assert.ok(ctx.calls.some(function (c) { return c[0] === "rm"; }));
  });
});

test("loop: failed slice removes partial wav", function () {
  var ctx = makeCtx({ sliceResult: 1 });
  var st = loop.createState();
  return loop.tick(st, ctx).then(function () {
    assert.ok(ctx.calls.some(function (c) { return c[0] === "rm"; }));
  });
});

test("loop: cumSegs capped", function () {
  var kept = loop.appendCapped([1, 2, 3], [4, 5], 4);
  assert.deepStrictEqual(kept, [2, 3, 4, 5]);
});

test("loop: big time jump inside tick flushes", function () {
  var ctx = makeCtx({});
  var st = loop.createState();
  st.lastPos = 0;
  ctx.pos = 50;
  return loop.tick(st, ctx).then(function (r) {
    assert.strictEqual(r, "ok");
    assert.ok(kinds(ctx).indexOf("clear") !== -1);
    assert.ok(kinds(ctx).indexOf("subs") !== -1);
  });
});
