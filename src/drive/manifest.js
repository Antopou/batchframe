// .sync-manifest.json — the local record of which Drive folder backs a local
// cache directory and what state each file is in relative to Drive.
//
// Path in memory:
//   {
//     driveFolderId, datasetName, pulledAt,
//     startPageToken,  // for Drive changes API pre-flight conflict check
//     files: {
//       "<posix relPath>": {
//         driveFileId, driveMd5, driveModifiedTime,
//         localMtime, localSize,
//         state: "clean" | "modified" | "new" | "deleted" | "renamed",
//         renamedFrom?: "<old relPath>"   // for renamed only
//       }
//     },
//     folders: { "<posix relPath>": { driveFileId } }  // materialised folders
//   }

const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');

const MANIFEST_NAME = '.sync-manifest.json';
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg']);

function manifestPath(cacheRoot) {
  return path.join(cacheRoot, MANIFEST_NAME);
}

function manifestExistsSync(cacheRoot) {
  try { return fssync.statSync(manifestPath(cacheRoot)).isFile(); }
  catch { return false; }
}

async function read(cacheRoot) {
  try {
    const raw = await fs.readFile(manifestPath(cacheRoot), 'utf8');
    const m = JSON.parse(raw);
    m.files ||= {};
    m.folders ||= {};
    return m;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function write(cacheRoot, manifest) {
  const tmp = manifestPath(cacheRoot) + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf8');
  await fs.rename(tmp, manifestPath(cacheRoot));
}

// Walk up from absPath looking for a .sync-manifest.json. Returns
// { cacheRoot, manifest, relPath } or null if the file isn't inside a cache.
async function findForAbsPath(absPath) {
  let dir = path.dirname(absPath);
  const root = path.parse(dir).root;
  while (true) {
    try {
      const p = path.join(dir, MANIFEST_NAME);
      await fs.access(p);
      const manifest = await read(dir);
      if (manifest) {
        const rel = toPosix(path.relative(dir, absPath));
        return { cacheRoot: dir, manifest, relPath: rel };
      }
    } catch { /* not here */ }
    if (dir === root) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function toNative(p) {
  return p.split('/').join(path.sep);
}

async function statLocal(cacheRoot, relPath) {
  try {
    const s = await fs.stat(path.join(cacheRoot, toNative(relPath)));
    return { mtime: s.mtimeMs, size: s.size };
  } catch { return null; }
}

// State-transition helpers. All mutate `manifest.files` in place and return
// the new entry so callers can persist.

function markModified(manifest, relPath, localStat) {
  const entry = manifest.files[relPath];
  if (!entry) {
    // Modification of a file the manifest doesn't know about — treat as new.
    return markNew(manifest, relPath, localStat);
  }
  entry.state = 'modified';
  entry.driveMd5 = null;
  if (localStat) {
    entry.localMtime = localStat.mtime;
    entry.localSize = localStat.size;
  }
  return entry;
}

function markDeleted(manifest, relPath) {
  const entry = manifest.files[relPath];
  if (!entry) return null;
  if (entry.state === 'new') {
    // A brand-new local file that never made it to Drive — just drop it.
    delete manifest.files[relPath];
    return null;
  }
  entry.state = 'deleted';
  return entry;
}

function markNew(manifest, relPath, localStat) {
  const entry = {
    driveFileId: null,
    driveMd5: null,
    driveModifiedTime: null,
    localMtime: localStat?.mtime ?? Date.now(),
    localSize: localStat?.size ?? null,
    state: 'new',
  };
  manifest.files[relPath] = entry;
  return entry;
}

function markRenamed(manifest, oldRel, newRel, localStat) {
  const src = manifest.files[oldRel];
  if (!src) {
    // No prior tracking — treat destination as new.
    return markNew(manifest, newRel, localStat);
  }
  if (src.state === 'new') {
    // Rename before push — just move the key.
    delete manifest.files[oldRel];
    if (localStat) { src.localMtime = localStat.mtime; src.localSize = localStat.size; }
    manifest.files[newRel] = src;
    return src;
  }
  // Real rename: create renamed entry pointing at existing driveFileId.
  delete manifest.files[oldRel];
  const entry = {
    driveFileId: src.driveFileId,
    driveMd5: src.driveMd5,
    driveModifiedTime: src.driveModifiedTime,
    localMtime: localStat?.mtime ?? src.localMtime,
    localSize: localStat?.size ?? src.localSize,
    state: 'renamed',
    renamedFrom: oldRel,
  };
  manifest.files[newRel] = entry;
  return entry;
}

// Convenience: given absolute paths, resolve to relPath under the cache root.
function relFromAbs(cacheRoot, absPath) {
  return toPosix(path.relative(cacheRoot, absPath));
}

// Walks cacheRoot and reconciles with manifest.files. Detects:
//   - New files on disk (state -> new)
//   - Missing files that manifest thought were clean/modified (state -> deleted)
// Does not touch renamed/deleted/modified entries the caller already set.
async function refresh(cacheRoot, manifest) {
  const seen = new Set();
  async function walk(dir, prefix) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.name === MANIFEST_NAME) continue;
      const abs = path.join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(abs, rel);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (!IMAGE_EXTS.has(ext)) continue;
        seen.add(rel);
        const existing = manifest.files[rel];
        const s = await fs.stat(abs);
        if (!existing) {
          markNew(manifest, rel, { mtime: s.mtimeMs, size: s.size });
        } else if (existing.state === 'clean') {
          if (existing.localSize !== s.size || Math.abs(existing.localMtime - s.mtimeMs) > 2000) {
            markModified(manifest, rel, { mtime: s.mtimeMs, size: s.size });
          }
        }
      }
    }
  }
  await walk(cacheRoot, '');

  for (const rel of Object.keys(manifest.files)) {
    const entry = manifest.files[rel];
    if (entry.state === 'deleted' || entry.state === 'new') continue;
    if (!seen.has(rel)) {
      // File disappeared externally.
      entry.state = 'deleted';
    }
  }
  return manifest;
}

function summary(manifest) {
  const counts = { clean: 0, modified: 0, new: 0, deleted: 0, renamed: 0 };
  for (const entry of Object.values(manifest.files || {})) {
    counts[entry.state] = (counts[entry.state] || 0) + 1;
  }
  const dirty = counts.modified + counts.new + counts.deleted + counts.renamed;
  return { counts, dirty, total: Object.keys(manifest.files || {}).length };
}

function hasDirty(manifest) {
  return summary(manifest).dirty > 0;
}

module.exports = {
  MANIFEST_NAME,
  manifestPath,
  manifestExistsSync,
  read,
  write,
  findForAbsPath,
  toPosix,
  toNative,
  statLocal,
  relFromAbs,
  markModified,
  markDeleted,
  markNew,
  markRenamed,
  refresh,
  summary,
  hasDirty,
};
