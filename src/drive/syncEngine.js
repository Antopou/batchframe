// pull / push / conflict-check between a local cache directory and a Drive
// folder. Callers supply an authenticated OAuth2 client and a progress hook.

const fs = require('fs').promises;
const path = require('path');
const driveApi = require('./driveApi');
const manifest = require('./manifest');

const DOWNLOAD_CONCURRENCY = 6;
const UPLOAD_CONCURRENCY = 4;

function sanitizeName(name) {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'dataset';
}

function cachePathFor(baseDir, datasetName, driveFolderId) {
  return path.join(baseDir, sanitizeName(datasetName));
}

// Runs jobs with bounded concurrency. jobs is an array of thunks returning promises.
async function runPool(jobs, concurrency) {
  const queue = jobs.slice();
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const job = queue.shift();
      await job();
    }
  });
  await Promise.all(workers);
}

function extMime(name) {
  const ext = path.extname(name).toLowerCase();
  return {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  }[ext] || 'application/octet-stream';
}

// -----------------------------------------------------------------------------
// PULL
// -----------------------------------------------------------------------------

async function pullDataset(auth, { driveFolderId, datasetName, cacheBaseDir, onProgress, strategy = 'merge' }) {
  const cacheRoot = cachePathFor(cacheBaseDir, datasetName, driveFolderId);
  await fs.mkdir(cacheRoot, { recursive: true });

  // Fresh capture of the change cursor BEFORE we list, so we don't miss
  // Drive changes that happen mid-walk.
  const startPageToken = await driveApi.getStartPageToken(auth);

  onProgress?.({ phase: 'listing', message: 'Listing Drive files…' });
  const { files, folders } = await driveApi.walkFolder(auth, driveFolderId);

  // Materialise local directory tree.
  for (const f of folders) {
    await fs.mkdir(path.join(cacheRoot, manifest.toNative(f.relPath)), { recursive: true });
  }

  // Merge with existing manifest so a re-pull only downloads changed / new files.
  const existing = (await manifest.read(cacheRoot)) || {
    driveFolderId,
    datasetName,
    files: {},
    folders: {},
  };
  const nextFiles = {};
  const nextFolders = {};
  for (const f of folders) nextFolders[f.relPath] = { driveFileId: f.id };

  // Local dirty state survives a pull. Without this, re-pulling mid-cull
  // re-downloads locally-deleted files and erases their 'deleted' marks (so
  // the eventual push would delete nothing on Drive), clobbers unpushed
  // local edits, and turns unpushed renames into duplicates.
  const carryOver = {};       // relPath -> entry, every non-clean entry
  const dirtyIds = new Set(); // driveFileIds owned by those entries
  if (strategy !== 'overwrite-local') {
    for (const [rel, entry] of Object.entries(existing.files)) {
      if (entry.state && entry.state !== 'clean') {
        carryOver[rel] = entry;
        if (entry.driveFileId) dirtyIds.add(entry.driveFileId);
      }
    }
  }

  const toDownload = [];
  for (const f of files) {
    // If we have a local dirty file at this path, it survives the pull.
    // If it's a 'new' file (no driveFileId), it might be a partially pushed file
    // that crashed before the manifest saved. Adopt the Drive ID to prevent conflicts!
    if (carryOver[f.relPath]) {
      if (!carryOver[f.relPath].driveFileId) {
        carryOver[f.relPath].driveFileId = f.id;
        dirtyIds.add(f.id);
      }
      continue;
    }
    
    // A dirty local entry (e.g. renamed locally) owns this Drive file.
    if (dirtyIds.has(f.id)) continue;
    
    const prior = existing.files[f.relPath];
    const localExists = prior && (await manifest.statLocal(cacheRoot, f.relPath));
    const upToDate = prior
      && prior.driveFileId === f.id
      && prior.driveMd5 === f.md5
      && prior.driveModifiedTime === f.modifiedTime
      && localExists
      && localExists.size === f.size;
      
    if (!upToDate) toDownload.push(f);
    
    nextFiles[f.relPath] = {
      driveFileId: f.id,
      driveMd5: f.md5,
      driveModifiedTime: f.modifiedTime,
      localMtime: localExists?.mtime ?? null,
      localSize: localExists?.size ?? f.size,
      state: 'clean',
    };
  }

  // Dirty entries win over any same-relPath clean entry from the walk.
  Object.assign(nextFiles, carryOver);

  const total = toDownload.length;
  let done = 0;
  onProgress?.({ phase: 'downloading', current: 0, total });

  const jobs = toDownload.map((f) => async () => {
    const dest = path.join(cacheRoot, manifest.toNative(f.relPath));
    await driveApi.downloadFile(auth, f.id, dest);
    const s = await fs.stat(dest);
    nextFiles[f.relPath].localMtime = s.mtimeMs;
    nextFiles[f.relPath].localSize = s.size;
    done += 1;
    onProgress?.({ phase: 'downloading', current: done, total, relPath: f.relPath });
  });
  await runPool(jobs, DOWNLOAD_CONCURRENCY);

  if (strategy === 'overwrite-local') {
    onProgress?.({ phase: 'cleaning', message: 'Removing unpushed local files…' });
    async function purge(dir, prefix) {
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); }
      catch { return; }
      for (const e of entries) {
        if (dir === cacheRoot && e.name === manifest.MANIFEST_NAME) continue;
        const abs = path.join(dir, e.name);
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory()) {
          await purge(abs, rel);
          if (!nextFolders[rel]) {
            try { await fs.rmdir(abs); } catch { /* ignore */ }
          }
        } else if (e.isFile()) {
          if (!nextFiles[rel]) {
            try { await fs.unlink(abs); } catch { /* ignore */ }
          }
        }
      }
    }
    await purge(cacheRoot, '');
  }

  const nextManifest = {
    driveFolderId,
    datasetName,
    pulledAt: new Date().toISOString(),
    startPageToken,
    files: nextFiles,
    folders: nextFolders,
  };
  await manifest.write(cacheRoot, nextManifest);

  onProgress?.({ phase: 'done', current: total, total });
  return { cacheRoot, manifest: nextManifest };
}

// -----------------------------------------------------------------------------
// CONFLICT DETECTION
// -----------------------------------------------------------------------------

async function detectConflicts(auth, cacheRoot) {
  const m = await manifest.read(cacheRoot);
  if (!m || !m.startPageToken) return { conflicts: [], newStartPageToken: null };

  const { changes, newStartPageToken } = await driveApi.listChanges(auth, m.startPageToken);

  // Build fileId -> relPath lookup from our manifest.
  const trackedIds = new Map();
  for (const [rel, entry] of Object.entries(m.files)) {
    if (entry.driveFileId) trackedIds.set(entry.driveFileId, rel);
  }
  const folderIds = new Set(Object.values(m.folders || {}).map((f) => f.driveFileId).filter(Boolean));
  folderIds.add(m.driveFolderId);

  const conflicts = [];
  for (const c of changes) {
    if (!c.file && c.fileId && trackedIds.has(c.fileId)) {
      conflicts.push({ fileId: c.fileId, relPath: trackedIds.get(c.fileId), reason: 'removed' });
      continue;
    }
    if (!c.file) continue;
    const rel = trackedIds.get(c.fileId);
    if (rel) {
      const entry = m.files[rel];
      const remoteMoved = !!c.file.trashed || (c.file.md5Checksum && c.file.md5Checksum !== entry.driveMd5);
      
      if (remoteMoved) {
        conflicts.push({
          fileId: c.fileId,
          relPath: rel,
          reason: c.file.trashed ? 'trashed' : 'modified',
          remoteName: c.file.name,
        });
      }
      continue;
    }
    // File we don't track — is it a new file inside one of our folders?
    // Skip if it's a folder we already track (e.g. created by our own recent push).
    if (folderIds.has(c.fileId)) continue;

    const parents = c.file.parents || [];
    if (parents.some((p) => folderIds.has(p))) {
      conflicts.push({
        fileId: c.fileId,
        relPath: null,
        reason: 'new-on-drive',
        remoteName: c.file.name,
      });
    }
  }
  return { conflicts, newStartPageToken };
}

// -----------------------------------------------------------------------------
// PUSH
// -----------------------------------------------------------------------------

async function ensureFolder(auth, m, relDir, folderLocks = {}) {
  if (!relDir || relDir === '.' || relDir === '') return m.driveFolderId;
  if (m.folders[relDir]?.driveFileId) return m.folders[relDir].driveFileId;
  
  if (folderLocks[relDir]) return await folderLocks[relDir];
  
  const promise = (async () => {
    const parentRel = relDir.includes('/') ? relDir.slice(0, relDir.lastIndexOf('/')) : '';
    const parentId = await ensureFolder(auth, m, parentRel, folderLocks);
    const name = relDir.split('/').pop();
    
    let folder = await driveApi.findFolder(auth, parentId, name);
    let createdId;
    if (folder) {
      createdId = folder.id;
      if (folder.name !== name) {
        await driveApi.updateFile(auth, createdId, { name });
      }
    } else {
      const created = await driveApi.createFolder(auth, { parentId, name });
      createdId = created.id;
    }
    
    m.folders[relDir] = { driveFileId: createdId };
    return createdId;
  })();
  folderLocks[relDir] = promise;
  return promise;
}

async function pushDataset(auth, cacheRoot, { onProgress, force = false } = {}) {
  const m = await manifest.read(cacheRoot);
  if (!m) throw new Error('No manifest — this folder is not a Drive-backed cache.');

  // Pre-flight conflict check unless the caller forces a push.
  let newStartPageToken = null;
  if (!force) {
    const conflict = await detectConflicts(auth, cacheRoot);
    if (conflict.conflicts.length > 0) {
      return { ok: false, conflicts: conflict.conflicts };
    }
    newStartPageToken = conflict.newStartPageToken;
  }

  // Categorise entries. Order matters for renames-on-modified etc.
  const folderLocks = {};
  const news = [];
  const modifieds = [];
  const renameds = [];
  const deleteds = [];
  for (const [rel, entry] of Object.entries(m.files)) {
    if (entry.state === 'new') news.push(rel);
    else if (entry.state === 'modified') modifieds.push(rel);
    else if (entry.state === 'renamed') renameds.push(rel);
    else if (entry.state === 'deleted') deleteds.push(rel);
  }
  const total = news.length + modifieds.length + renameds.length + deleteds.length;
  let done = 0;
  const tick = (relPath) => {
    done += 1;
    onProgress?.({ phase: 'pushing', current: done, total, relPath });
  };

  onProgress?.({ phase: 'pushing', current: 0, total });

  let pushSuccess = false;
  try {
    // 1. Deletes first
    const delJobs = deleteds.map((rel) => async () => {
      const entry = m.files[rel];
      if (entry.driveFileId) {
        try { await driveApi.trashFile(auth, entry.driveFileId); }
        catch (err) {
          // If the file is already gone on Drive (404), treat as success.
          if (err.code !== 404 && err.response?.status !== 404) throw err;
        }
      }
      delete m.files[rel];
      tick(rel);
    });
    await runPool(delJobs, UPLOAD_CONCURRENCY);

    // 2. Renames — metadata-only updates.
    const renJobs = renameds.map((rel) => async () => {
      const entry = m.files[rel];
      if (!entry.driveFileId) {
        news.push(rel);
        delete m.files[rel];
        return;
      }
      const oldRel = entry.renamedFrom || rel;
      const oldName = oldRel.split('/').pop();
      const newName = rel.split('/').pop();
      const oldDir = oldRel.includes('/') ? oldRel.slice(0, oldRel.lastIndexOf('/')) : '';
      const newDir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      const params = {};
      if (oldName !== newName) params.name = newName;
      if (oldDir !== newDir) {
        const oldParentId = m.folders[oldDir]?.driveFileId || m.driveFolderId;
        const newParentId = await ensureFolder(auth, m, newDir, folderLocks);
        params.addParents = newParentId;
        params.removeParents = oldParentId;
      }
      const updated = await driveApi.updateFile(auth, entry.driveFileId, params);
      entry.state = 'clean';
      entry.driveMd5 = updated.md5Checksum || entry.driveMd5;
      entry.driveModifiedTime = updated.modifiedTime || entry.driveModifiedTime;
      delete entry.renamedFrom;
      tick(rel);
    });
    await runPool(renJobs, UPLOAD_CONCURRENCY);

    // 3. Modifieds — content update.
    const modJobs = modifieds.map((rel) => async () => {
      const entry = m.files[rel];
      if (!entry) return;
      const abs = path.join(cacheRoot, manifest.toNative(rel));
      const updated = await driveApi.updateFile(auth, entry.driveFileId, {
        localPath: abs,
        mimeType: extMime(rel),
      });
      entry.state = 'clean';
      entry.driveMd5 = updated.md5Checksum || null;
      entry.driveModifiedTime = updated.modifiedTime || null;
      const s = await fs.stat(abs);
      entry.localMtime = s.mtimeMs;
      entry.localSize = s.size;
      tick(rel);
    });
    await runPool(modJobs, UPLOAD_CONCURRENCY);

    // 4. News — fresh uploads.
    const newJobs = news.map((rel) => async () => {
      const entry = m.files[rel];
      if (!entry) return;
      const abs = path.join(cacheRoot, manifest.toNative(rel));
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      const name = rel.split('/').pop();
      const parentId = await ensureFolder(auth, m, dir, folderLocks);
      
      // Deduplicate: Check if it already exists on Drive
      const existing = await driveApi.findFileInFolder(auth, parentId, name);
      let created;
      if (existing) {
        created = await driveApi.updateFile(auth, existing.id, {
          localPath: abs,
          mimeType: extMime(rel),
        });
      } else {
        created = await driveApi.uploadFile(auth, {
          parentId,
          name,
          localPath: abs,
          mimeType: extMime(rel),
        });
      }
      
      entry.driveFileId = created.id;
      entry.driveMd5 = created.md5Checksum || null;
      entry.driveModifiedTime = created.modifiedTime || null;
      entry.state = 'clean';
      const s = await fs.stat(abs);
      entry.localMtime = s.mtimeMs;
      entry.localSize = s.size;
      tick(rel);
    });
    await runPool(newJobs, UPLOAD_CONCURRENCY);

    // Refresh the change cursor so the next push has a clean baseline.
    // We fetch a brand new token here so our own uploads aren't seen as external changes next time.
    m.startPageToken = await driveApi.getStartPageToken(auth);
    m.pulledAt = new Date().toISOString();
    pushSuccess = true;
  } finally {
    // Save manifest even on crash so we don't lose newly attached driveFileIds!
    await manifest.write(cacheRoot, m);
  }

  if (pushSuccess) {
    onProgress?.({ phase: 'done', current: total, total });
    return { ok: true, manifest: m };
  }
  return { ok: false };
}

// -----------------------------------------------------------------------------
// CLEAR LOCAL CACHE
// -----------------------------------------------------------------------------

// Removes cached image files but preserves the manifest file so a re-pull is
// fast (only re-downloads files whose Drive metadata changed). If keepManifest
// is false, the whole cache directory is wiped.
async function clearLocalCache(cacheRoot, { keepManifest = true } = {}) {
  const m = await manifest.read(cacheRoot);
  if (!m) throw new Error('No manifest — refusing to delete unknown folder.');
  if (manifest.hasDirty(m)) {
    return { ok: false, error: 'unsynced-changes', summary: manifest.summary(m) };
  }

  async function purge(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (dir === cacheRoot && e.name === manifest.MANIFEST_NAME && keepManifest) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        await purge(abs);
        try { await fs.rmdir(abs); } catch { /* not empty is fine */ }
      } else {
        try { await fs.unlink(abs); } catch { /* ignore */ }
      }
    }
  }
  await purge(cacheRoot);

  if (keepManifest) {
    // Reset localMtime/size so re-pull knows nothing is on disk.
    for (const entry of Object.values(m.files)) {
      entry.localMtime = null;
      entry.localSize = null;
    }
    await manifest.write(cacheRoot, m);
  } else {
    try { await fs.rmdir(cacheRoot); } catch { /* ignore */ }
  }
  return { ok: true };
}

// -----------------------------------------------------------------------------
// EXTERNAL REFRESH (e.g. before push, or on user request)
// -----------------------------------------------------------------------------

async function refreshManifest(cacheRoot) {
  const m = await manifest.read(cacheRoot);
  if (!m) return null;
  await manifest.refresh(cacheRoot, m);
  await manifest.write(cacheRoot, m);
  return m;
}

async function linkDataset(auth, { localPath, driveFolderId, datasetName, onProgress }) {
  if (onProgress) onProgress({ type: 'status', text: 'Initializing manifest...' });
  const startPageToken = await driveApi.getStartPageToken(auth);
  const m = {
    driveFolderId,
    datasetName,
    pulledAt: new Date().toISOString(),
    startPageToken,
    files: {},
    folders: {}
  };
  await manifest.refresh(localPath, m);
  await manifest.write(localPath, m);
  
  return { ok: true, cacheRoot: localPath };
}

module.exports = {
  cachePathFor,
  sanitizeName,
  runPool,
  pullDataset,
  pushDataset,
  linkDataset,
  detectConflicts,
  clearLocalCache,
  refreshManifest,
};
