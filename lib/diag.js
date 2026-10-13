// Diagnostics report builder (pure, node-testable). main.js gathers the
// info object; this formats Log Viewer lines + a short OSD summary.
function formatReport(info) {
  var lines = [];
  lines.push("diag url=" + info.url);
  lines.push("diag stream=" + info.isStream + " streamOk=" + info.streamOk);
  lines.push("diag bins ffmpeg=" + info.ffmpeg + " whisper=" + info.whisper + " model=" + info.model);
  lines.push("diag status idle=" + info.idle + " paused=" + info.paused + " pos=" + info.pos +
    " speed=" + info.speed);
  lines.push("diag standby=" + info.standby + " subs=" + info.subTracks +
    " audio=" + info.audioTracks);
  lines.push("diag loop busy=" + info.busy + " fails=" + info.fails +
    " pausedLoop=" + info.pausedLoop + " segs=" + info.segs);
  lines.push("diag prefs lang=" + info.lang + " model=" + info.modelPref +
    " chunk=" + info.chunk);
  return lines;
}

function shortSummary(info) {
  if (info.standby && info.standby !== "null") return "standby: " + info.standby;
  if (!info.ffmpeg || !info.whisper || !info.model) return "setup needed";
  if (info.pausedLoop) return "paused after slice fails";
  return info.segs + " segments so far";
}

module.exports = {
  formatReport: formatReport,
  shortSummary: shortSummary,
};
