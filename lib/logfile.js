// Bounded file logger: ring buffer in memory, full rewrite on flush.
// (The file API has no append; logs stay small so rewrite is cheap.)
function create(maxLines) {
  return { max: maxLines || 200, lines: [], dirty: false };
}

function push(buf, line) {
  buf.lines.push(new Date().toISOString().slice(11, 19) + " " + line);
  while (buf.lines.length > buf.max) buf.lines.shift();
  buf.dirty = true;
}

// writeFn(path, content) — e.g. file.write. Returns true when flushed.
function flush(buf, writeFn, path) {
  if (!buf.dirty) return false;
  try {
    writeFn(path, buf.lines.join("\n") + "\n");
    buf.dirty = false;
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  create: create,
  push: push,
  flush: flush,
};
