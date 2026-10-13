// Stream handling (spec §4): resolve playable URL, decide sliceability.
// Unresolvable/page URLs -> standby "unsupported-stream" (no retry storm).
function resolveUrl(statusUrl, mpvGetString) {
  try {
    var resolved = mpvGetString("stream-open-filename");
    if (resolved && resolved !== statusUrl) return resolved;
  } catch (e) {}
  return statusUrl;
}

function isSliceable(url) {
  var u = String(url || "").split("?")[0].split("#")[0].toLowerCase();
  if (/\.m3u8$/.test(u)) return true;
  if (/\.(mp4|mkv|webm|mov|m4v|mp3|m4a|wav|flac|ogg|ogv|ts|m2ts)$/.test(u)) return true;
  return false;
}

module.exports = {
  resolveUrl: resolveUrl,
  isSliceable: isSliceable,
};
