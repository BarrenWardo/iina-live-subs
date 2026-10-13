// Minimal test runner: `node tests/run.js`. Test files match tests/test-*.js
// and use global test(name, fn) + global assert.
var fs = require("fs");

var passes = 0;
var failures = 0;
var pending = [];

global.test = function (name, fn) {
  function pass() { passes += 1; console.log("PASS " + name); }
  function fail(e) { failures += 1; console.log("FAIL " + name + ": " + (e && e.message)); }
  try {
    var r = fn();
    if (r && typeof r.then === "function") {
      pending.push(r.then(pass, fail));
    } else {
      pass();
    }
  } catch (e) {
    fail(e);
  }
};
global.assert = require("assert");

fs.readdirSync(__dirname)
  .filter(function (f) { return /^test-.*\.js$/.test(f); })
  .sort()
  .forEach(function (f) {
    try {
      require("./" + f);
    } catch (e) {
      failures += 1;
      console.log("FAIL " + f + ": " + (e && e.message));
    }
  });

Promise.all(pending).then(function () {
  console.log(passes + " passed, " + failures + " failed");
  process.exit(failures ? 1 : 0);
});
