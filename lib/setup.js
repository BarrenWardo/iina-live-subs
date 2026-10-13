// Binary + model setup (spec §3).
// Verified against IINA source (JavascriptAPIUtils.parsePath): relative
// bundle paths ("bin/...") can NEVER execute — only absolute, @tmp/@data,
// ~/ or track pseudo-paths resolve. GUI apps also lack Homebrew in PATH,
// so the sanctioned pattern is used: binaries download once into
// @data/bin/ (absolute), where exec even auto-fixes the exec bit.
// Single-arch arm64 assets for now (Ruling); Intel best-effort later.
var REPO = "BarrenWardo/iina-live-subs";
var MODEL_URLS = {
  tiny: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
  base: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
  small: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
};

function binPath(dataDir, name) {
  return dataDir + "/bin/" + name;
}

function binAssetUrl(asset) {
  return "https://github.com/" + REPO + "/releases/latest/download/" + asset;
}

// fileDownload(url, dest) -> Promise; fileExists(path) -> bool.
function ensureFile(fileDownload, fileExists, url, dest) {
  try {
    if (fileExists(dest)) return Promise.resolve(dest);
  } catch (e) {}
  return fileDownload(url, dest).then(function () {
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

function ensureBin(fileDownload, fileExists, dataDir, name, assetUrl) {
  return ensureFile(fileDownload, fileExists, assetUrl, binPath(dataDir, name));
}

function setupState(parts) {
  if (!parts.ffmpeg || !parts.whisper) return "need-bin";
  if (!parts.model) return "need-model";
  return "ready";
}

// httpDownload(url, dest) -> Promise; fileExists(path) -> bool.
function ensureModel(httpDownload, fileExists, dataDir, model) {
  var url = MODEL_URLS[model] || MODEL_URLS.tiny;
  return ensureFile(httpDownload, fileExists, url, dataDir + "/ggml-" + model + ".bin");
}

module.exports = {
  binPath: binPath,
  binAssetUrl: binAssetUrl,
  ensureFile: ensureFile,
  ensureBin: ensureBin,
  ensureModel: ensureModel,
  setupState: setupState,
  MODEL_URLS: MODEL_URLS,
};
