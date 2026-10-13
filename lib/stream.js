// Stream handling (spec §4): resolve playable URL, decide whether slicing
// is worth attempting. Direct-file URLs often carry no extension
// (e.g. signed ?fid= download links), so this is a BLOCKLIST: attempt
// anything http(s) except known page URLs. Genuine misses fail fast in
// ffmpeg and ride the loop's slow-retry + recoverable backoff.
var BLOCKED_HOSTS = [
  "youtube.com",
  "youtu.be",
  "m.youtube.com",
  "vimeo.com",
  "dailymotion.com",
  "dai.ly",
  "twitch.tv",
  "netflix.com",
];

function hostOf(url) {
  var m = /^https?:\/\/([^/?#]+)/i.exec(String(url || ""));
  return m ? m[1].toLowerCase() : "";
}

function isBlockedPage(url) {
  var host = hostOf(url);
  for (var i = 0; i < BLOCKED_HOSTS.length; i++) {
    var b = BLOCKED_HOSTS[i];
    if (host === b || host.slice(-b.length - 1) === "." + b) return true;
  }
  return false;
}

function resolveUrl(statusUrl, mpvGetString) {
  try {
    var resolved = mpvGetString("stream-open-filename");
    if (resolved && resolved !== statusUrl) return resolved;
  } catch (e) {}
  return statusUrl;
}

// True = worth attempting a slice. False only for known page URLs.
function isSliceable(url) {
  var u = String(url || "");
  if (!/^https?:\/\//i.test(u)) return false;
  return !isBlockedPage(u);
}

module.exports = {
  resolveUrl: resolveUrl,
  isSliceable: isSliceable,
  isBlockedPage: isBlockedPage,
};
