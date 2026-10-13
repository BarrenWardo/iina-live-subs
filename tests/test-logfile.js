var logfile = require("../lib/logfile");

test("logfile: flush writes joined lines once, then clean", function () {
  var buf = logfile.create(10);
  var written = [];
  assert.strictEqual(logfile.flush(buf, function (p, c) { written.push([p, c]); }, "@data/x.log"), false);
  logfile.push(buf, "a");
  logfile.push(buf, "b");
  assert.strictEqual(logfile.flush(buf, function (p, c) { written.push([p, c]); }, "@data/x.log"), true);
  assert.ok(written[0][1].indexOf("\na\n") === -1); // timestamps prefixed
  assert.ok(written[0][1].indexOf(" a\n") !== -1 || written[0][1].indexOf("a") !== -1);
  assert.strictEqual(logfile.flush(buf, function (p, c) { written.push([p, c]); }, "@data/x.log"), false);
});

test("logfile: ring cap drops oldest", function () {
  var buf = logfile.create(2);
  logfile.push(buf, "1");
  logfile.push(buf, "2");
  logfile.push(buf, "3");
  var out = [];
  logfile.flush(buf, function (p, c) { out.push(c); }, "p");
  assert.ok(out[0].indexOf(" 1\n") === -1);
  assert.ok(out[0].indexOf(" 2\n") !== -1);
  assert.ok(out[0].indexOf(" 3\n") !== -1);
  assert.strictEqual(buf.lines.length, 2);
});

test("logfile: write failure keeps dirty", function () {
  var buf = logfile.create(10);
  logfile.push(buf, "x");
  function boom() { throw new Error("ro"); }
  assert.strictEqual(logfile.flush(buf, boom, "p"), false);
  assert.strictEqual(buf.dirty, true);
});
