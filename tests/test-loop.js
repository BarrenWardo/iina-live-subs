var loop = require("../lib/loop");

function makeCtx(over) {
  var ctx = {
    calls: [],
    standby: null,
    paused: false,
    pos: 10,
    chunk: 5,
    speed: 1,
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

test("loop: three slice fails pause the loop + osd", function () {
  var ctx = makeCtx({ sliceResult: 1 });
  var st = loop.createState();
  return loop.tick(st, ctx).then(function () {
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
