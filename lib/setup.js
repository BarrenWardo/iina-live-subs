// Binary + model setup (spec §3). Injected fns keep this node-testable.
// No arch detection exists in the plugin API, so order is fixed:
// universal build first, then arm64, then x64. Prefer shipping a
// universal2 binary (see bin/README.md); existence is all we can check.
var MODEL_URLS = {
  tiny: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
  base: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
  small: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
};

function pickBin(existsFn, name, allowPathFallback) {
  var cands = ["bin/" + name, "bin/" + name + "-arm64", "bin/" + name + "-x64"];
  for (var i = 0; i < cands.length; i++) {
    try {
      if (existsFn(cands[i])) return cands[i];
    } catch (e) {}
  }
  if (allowPathFallback && name === "ffmpeg") {
    try {
      if (existsFn("ffmpeg")) return "ffmpeg";
    } catch (e) {}
  }
  return null;
}

// httpDownload(url, dest) -> Promise; fileExists(path) -> bool.
function ensureModel(httpDownload, fileExists, dataDir, model) {
  var dest = dataDir + "/ggml-" + model + ".bin";
  try {
    if (fileExists(dest)) return Promise.resolve(dest);
  } catch (e) {}
  var url = MODEL_URLS[model] || MODEL_URLS.tiny;
  return httpDownload(url, dest).then(function () {
    try {
      if (fileExists(dest)) return dest;
    } catch (e) {}
    return null;
  }).then(function (p) {
    return p;
  }, function () {
    return null;
  });
}

function setupState(parts) {
  if (!parts.ffmpeg || !parts.whisper) return "need-bin";
  if (!parts.model) return "need-model";
  return "ready";
}

module.exports = {
  pickBin: pickBin,
  ensureModel: ensureModel,
  setupState: setupState,
  MODEL_URLS: MODEL_URLS,
};
