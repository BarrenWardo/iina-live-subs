// Preference access. In IINA, reads live values; `fallback` mirrors
// Info.json preferenceDefaults when the key is unset.
function get(key, fallback) {
  try {
    var v = iina.preferences.get(key);
    return v === undefined || v === null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

module.exports = { get: get };
