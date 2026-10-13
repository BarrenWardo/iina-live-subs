// ffmpeg audio slicing (spec §4). Pure builders + injected exec.
// audioIdx: mpv audio track id; null/undefined = default audio stream.
function buildSliceArgs(src, audioIdx, start, len) {
  var args = ["-ss", String(start), "-t", String(len), "-i", src];
  if (audioIdx === null || audioIdx === undefined) {
    args.push("-map", "0:a:0");
  } else {
    args.push("-map", "0:a:" + audioIdx);
  }
  return args.concat(["-ar", "16000", "-ac", "1", "-f", "wav", "-y"]);
}

// outPath appended by caller via slice(); builder ends with -y, caller adds path.
function pickAudioIdx(audioTracks) {
  var tracks = audioTracks || [];
  for (var i = 0; i < tracks.length; i++) {
    if (tracks[i].isSelected) return tracks[i].id;
  }
  return null;
}

function audioPseudo(id) {
  return "@audio/" + id;
}

// exec: utils.exec-shaped (bin, args) -> Promise<{status}>. Resolves status.
function slice(exec, ffmpegBin, args, outPath) {
  return exec(ffmpegBin, args.concat([outPath])).then(function (res) {
    return res.status;
  });
}

module.exports = {
  buildSliceArgs: buildSliceArgs,
  pickAudioIdx: pickAudioIdx,
  audioPseudo: audioPseudo,
  slice: slice,
};
