// whisper.cpp translate engine (spec §3-4). Direct JA speech -> EN text.
function buildWhisperArgs(model, wav, lang) {
  return ["-m", model, "-f", wav, "-l", lang, "--translate", "-oj", "-ot", "-pp", "-nt"];
}

function modelPath(dataDir, model) {
  return dataDir + "/ggml-" + model + ".bin";
}

function tsToSec(ts) {
  // "HH:MM:SS,mmm"
  var m = /^(\d+):(\d+):([\d.]+)$/.exec(String(ts).replace(",", "."));
  if (!m) return null;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
}

// Never throws: corrupt input -> []. Drops empty-text segments.
function parseWhisperJson(stdout) {
  var doc;
  try {
    doc = JSON.parse(stdout);
  } catch (e) {
    return [];
  }
  var list = doc && doc.transcription;
  if (!Array.isArray(list)) return [];
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var s = list[i] || {};
    var text = String(s.text || "").trim();
    if (!text) continue;
    var t0 = null;
    var t1 = null;
    if (s.offsets && typeof s.offsets.from === "number" && typeof s.offsets.to === "number") {
      t0 = s.offsets.from / 1000;
      t1 = s.offsets.to / 1000;
    } else if (s.timestamps) {
      t0 = tsToSec(s.timestamps.from);
      t1 = tsToSec(s.timestamps.to);
    }
    if (t0 === null || t1 === null) continue;
    out.push({ t0: t0, t1: t1, text: text });
  }
  return out;
}

// Best-effort detected-language extractor (spec §6 EN-audio standby).
// whisper.cpp -oj shape is unverified on this machine: returns the field
// when present, null otherwise. Never throws.
function detectLang(stdout) {
  try {
    var doc = JSON.parse(stdout);
    if (doc && typeof doc.language === "string") return doc.language;
    if (doc && typeof doc.detected_language === "string") return doc.detected_language;
  } catch (e) {}
  return null;
}

module.exports = {
  buildWhisperArgs: buildWhisperArgs,
  modelPath: modelPath,
  parseWhisperJson: parseWhisperJson,
  detectLang: detectLang,
};
