// Minimal test runner: `node tests/run.js`. Test files match tests/test-*.js
// and use global test(name, fn) + global assert.
var fs = require("fs");

var passes = 0;
var failures = 0;

global.test = function (name, fn) {
  try {
    fn();
    passes += 1;
    console.log("PASS " + name);
  } catch (e) {
    failures += 1;
    console.log("FAIL " + name + ": " + (e && e.message));
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

console.log(passes + " passed, " + failures + " failed");
process.exit(failures ? 1 : 0);
