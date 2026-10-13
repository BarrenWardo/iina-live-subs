var check = require("../lib/standby").check;

function status(over) {
  var s = { idle: false, position: 42 };
  for (var k in over) s[k] = over[k];
  return s;
}

test("standby: selected EN sub + pref on -> en-subs-present", function () {
  var r = check(status({}), [{ lang: "en", isSelected: true }], { standbyWhenEnSubs: true });
  assert.strictEqual(r, "en-subs-present");
});

test("standby: EN sub present but pref off -> null", function () {
  var r = check(status({}), [{ lang: "en", isSelected: true }], { standbyWhenEnSubs: false });
  assert.strictEqual(r, null);
});

test("standby: unselected EN sub -> null", function () {
  var r = check(status({}), [{ lang: "en", isSelected: false }], { standbyWhenEnSubs: true });
  assert.strictEqual(r, null);
});

test("standby: idle -> idle", function () {
  var r = check(status({ idle: true }), [], { standbyWhenEnSubs: true });
  assert.strictEqual(r, "idle");
});

test("standby: null position -> no-position", function () {
  var r = check(status({ position: null }), [], { standbyWhenEnSubs: true });
  assert.strictEqual(r, "no-position");
});

test("standby: clean state -> null", function () {
  var r = check(status({}), [], { standbyWhenEnSubs: true });
  assert.strictEqual(r, null);
});
