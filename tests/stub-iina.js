// Minimal `iina` global stub for node-based tests. Pure lib modules do not
// touch it; main.js-level tests use it to simulate player state.
var store = {};

function makeTrack(over) {
  var t = {
    id: 1, title: null, formattedTitle: "t", lang: null, codec: null,
    isDefault: false, isForced: false, isSelected: false, isExternal: false,
  };
  for (var k in over) t[k] = over[k];
  return t;
}

global.iina = {
  core: {
    status: { paused: false, idle: false, position: 0, duration: 100, speed: 1, isNetworkResource: false, url: "", title: "" },
    subtitle: { tracks: [] },
    audio: { tracks: [] },
    osd: function () {},
  },
  preferences: {
    get: function (k) { return store[k]; },
    set: function (k, v) { store[k] = v; },
  },
  __reset: function (s) {
    store = {};
    if (s) for (var k in s) store[k] = s[k];
    global.iina.core.subtitle.tracks = [];
    global.iina.core.status.paused = false;
    global.iina.core.status.idle = false;
    global.iina.core.status.position = 0;
  },
};

module.exports = { makeTrack: makeTrack };
