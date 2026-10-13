// Standby rules (spec §6). Pure: pass values in, no `iina` globals.
// status: {idle, position}; subtitleTracks: [{lang, isSelected}];
// prefs: {standbyWhenEnSubs}. Returns reason string or null when active.
function check(status, subtitleTracks, prefs) {
  if (status.idle) return "idle";
  if (status.position === null || status.position === undefined) return "no-position";
  if (prefs.standbyWhenEnSubs) {
    var tracks = subtitleTracks || [];
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      if (t.isSelected && t.lang && /^en/i.test(t.lang)) return "en-subs-present";
    }
  }
  return null;
}

module.exports = { check: check };
