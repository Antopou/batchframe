// Live Drive mode: presents a Drive folder through the same shapes as the
// local-filesystem IPC handlers in main.js, so the renderer can treat
// `drive://…` paths exactly like local ones.
//
// Path scheme is hierarchical — `drive://<rootId>/<subId>/<fileId>` — so the
// renderer's prefix-based root/parent navigation (App.js startsWith checks)
// works unmodified. The Drive fileId is always the last segment; the leading
// segments only encode the navigation chain.
//
// Metadata ops (rename/trash/move/copy) are pure API calls — no bytes move.
// Pixel ops materialise the single file into a small on-disk cache first.

const fsp = require('fs').promises;
const path = require('path');
const { app, net } = require('electron');
const driveApi = require('./driveApi');
const { runPool } = require('./syncEngine');
const { extForMime } = require('../utils/cropFormat');

const SCHEME = 'drive://';
const LISTING_TTL_MS = 8000;
const META_TTL_MS = 30000;
// Thumbnail links live for hours server-side; a long local TTL avoids a
// files.get per thumbnail once the listing cache has expired.
const THUMB_LINK_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_FILES = 1000;
const THUMB_SIZE = 512;
const PREVIEW_THUMB_SIZE = 256;
const OP_CONCURRENCY = 6;
// Matches Chromium's per-host socket pool, so queued thumbnails complete in
// the order they were asked for — the grid fills top-first instead of
// randomly as parallel fetches race each other.
const THUMB_CONCURRENCY = 6;

// ── Path helpers ──────────────────────────────────────────────────

function isDrivePath(p) {
  return typeof p === 'string' && p.startsWith(SCHEME);
}

function segments(p) {
  return p.slice(SCHEME.length).split('/').filter(Boolean);
}

// The Drive id a path points at — always the last segment.
function driveId(p) {
  const segs = segments(p);
  return segs[segs.length - 1] || null;
}

function joinDrive(parentPath, id) {
  return `${parentPath.replace(/\/+$/, '')}/${id}`;
}

// Parent is the path minus its last segment; null at the opened root.
function parentDrivePath(p) {
  const segs = segments(p);
  if (segs.length <= 1) return null;
  return SCHEME + segs.slice(0, -1).join('/');
}

// ── Caches ────────────────────────────────────────────────────────

// folderId -> { ts, items } raw driveApi.listFolder results.
const listingCache = new Map();
// fileId -> { ts, meta } single-file metadata.
const metaCache = new Map();
// fileId -> { ts, link, rev } thumbnail link + revision, long TTL. Kept out
// of invalidate(): a rename doesn't change pixels, so its thumb stays valid.
const thumbLinkCache = new Map();

// Mutations invalidate wholesale — both caches are tiny and short-lived, and
// correctness beats saving a relist here.
function invalidate() {
  listingCache.clear();
  metaCache.clear();
}

function rememberThumbLink(f) {
  thumbLinkCache.set(f.id, {
    ts: Date.now(),
    link: f.thumbnailLink || null,
    rev: f.modifiedTime ? Date.parse(f.modifiedTime) : 0,
  });
}

async function listCached(auth, folderId) {
  const hit = listingCache.get(folderId);
  if (hit && Date.now() - hit.ts < LISTING_TTL_MS) return hit.items;
  const items = await driveApi.listFolder(auth, folderId);
  listingCache.set(folderId, { ts: Date.now(), items });
  for (const f of items) {
    metaCache.set(f.id, { ts: Date.now(), meta: f });
    if (f.mimeType !== driveApi.FOLDER_MIME) rememberThumbLink(f);
  }
  return items;
}

async function metaFor(auth, fileId) {
  const hit = metaCache.get(fileId);
  if (hit && Date.now() - hit.ts < META_TTL_MS) return hit.meta;
  const meta = await driveApi.getFileMetadata(auth, fileId);
  metaCache.set(fileId, { ts: Date.now(), meta });
  return meta;
}

// ── Byte cache (full-file materialisation for preview / crop) ─────

function byteCacheDir() {
  return path.join(app.getPath('userData'), 'drive-live');
}

// Cache key ties the bytes to a specific Drive revision via modifiedTime.
function byteCacheName(fileId, meta) {
  const rev = meta.modifiedTime ? Date.parse(meta.modifiedTime) : 0;
  return `${fileId}-${rev}`;
}

async function evictByteCache() {
  try {
    const dir = byteCacheDir();
    const names = await fsp.readdir(dir);
    if (names.length <= MAX_CACHE_FILES) return;
    const stats = await Promise.all(names.map(async (n) => {
      const abs = path.join(dir, n);
      try { return { abs, mtime: (await fsp.stat(abs)).mtimeMs }; }
      catch { return null; }
    }));
    const sorted = stats.filter(Boolean).sort((a, b) => a.mtime - b.mtime);
    for (const s of sorted.slice(0, sorted.length - MAX_CACHE_FILES)) {
      try { await fsp.unlink(s.abs); } catch { /* ignore */ }
    }
  } catch { /* cache dir may not exist yet */ }
}

// Downloads the file's current revision into the byte cache (if not already
// there) and returns its absolute local path. Stale revisions are removed.
async function materialize(auth, drivePath) {
  const fileId = driveId(drivePath);
  const meta = await metaFor(auth, fileId);
  const dir = byteCacheDir();
  await fsp.mkdir(dir, { recursive: true });
  const dest = path.join(dir, byteCacheName(fileId, meta));
  try {
    await fsp.access(dest);
    return dest;
  } catch { /* not cached yet */ }

  // Drop older revisions of this file before pulling the fresh one (thumbs
  // and bytes of the current revision are kept).
  const currentPrefix = byteCacheName(fileId, meta);
  try {
    for (const n of await fsp.readdir(dir)) {
      if (n.startsWith(`${fileId}-`) && !n.startsWith(currentPrefix)) {
        await fsp.unlink(path.join(dir, n)).catch(() => {});
      }
    }
  } catch { /* ignore */ }

  await driveApi.downloadFile(auth, fileId, dest);
  evictByteCache();
  return dest;
}

// ── Thumbnails ────────────────────────────────────────────────────

function sizedThumbLink(link, size) {
  if (!link) return null;
  if (/=s\d+(-c)?$/.test(link)) return link.replace(/=s\d+(-c)?$/, `=s${size}`);
  return `${link}=s${size}`;
}

// Drive picks the thumbnail format itself (jpeg/png/webp, regardless of the
// source file's extension), so the mime must come from the bytes.
function sniffMime(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  return 'image/jpeg';
}

// ── Thumbnail fetch queue ─────────────────────────────────────────
// Strict FIFO with bounded concurrency: cards request thumbnails in display
// order (top of the grid first), and the queue preserves that order instead
// of letting dozens of parallel fetches finish at random.

const thumbQueue = [];
let thumbActive = 0;

function pumpThumbQueue() {
  while (thumbActive < THUMB_CONCURRENCY && thumbQueue.length) {
    const job = thumbQueue.shift();
    thumbActive += 1;
    job().finally(() => {
      thumbActive -= 1;
      pumpThumbQueue();
    });
  }
}

function enqueueThumb(fn) {
  return new Promise((resolve, reject) => {
    thumbQueue.push(() => fn().then(resolve, reject));
    pumpThumbQueue();
  });
}

// Current thumbnail link + revision for a file, via caches when possible.
async function thumbInfoFor(auth, fileId, { forceRefresh = false } = {}) {
  const hit = thumbLinkCache.get(fileId);
  if (!forceRefresh && hit && Date.now() - hit.ts < THUMB_LINK_TTL_MS) return hit;
  const meta = await driveApi.getFileMetadata(auth, fileId);
  metaCache.set(fileId, { ts: Date.now(), meta });
  rememberThumbLink(meta);
  return thumbLinkCache.get(fileId);
}

async function fetchThumbBuffer(auth, fileId, size) {
  let info = await thumbInfoFor(auth, fileId);

  // Disk cache first: `<fileId>-<rev>-t<size>`. Reopening a folder costs no
  // network at all once its thumbnails have been seen.
  const dir = byteCacheDir();
  const diskPath = path.join(dir, `${fileId}-${info.rev}-t${size}`);
  try { return await fsp.readFile(diskPath); } catch { /* not cached */ }

  if (!info.link) return null;
  return enqueueThumb(async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const link = sizedThumbLink(info.link, size);
      try {
        const res = await net.fetch(link, { redirect: 'follow' });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          try {
            await fsp.mkdir(dir, { recursive: true });
            // Drop thumbs of older revisions of this file, keep other sizes.
            for (const n of await fsp.readdir(dir)) {
              if (n.startsWith(`${fileId}-`) && n.includes('-t') && !n.startsWith(`${fileId}-${info.rev}-`)) {
                await fsp.unlink(path.join(dir, n)).catch(() => {});
              }
            }
            await fsp.writeFile(diskPath, buf);
            evictByteCache();
          } catch { /* disk cache is best-effort */ }
          return buf;
        }
      } catch { /* fall through to refresh */ }
      // thumbnailLink is a signed URL — refresh once and retry.
      info = await thumbInfoFor(auth, fileId, { forceRefresh: true });
      if (!info.link) return null;
    }
    return null;
  });
}

// ── Read side: shapes must match main.js local handlers exactly ───

// get-images → [{ name, path, size, mtime, width, height }]
async function getImages(auth, folderPath) {
  try {
    const items = await listCached(auth, driveId(folderPath));
    return items
      .filter((f) => f.mimeType !== driveApi.FOLDER_MIME && driveApi.isImage(f))
      .map((f) => ({
        name: f.name,
        path: joinDrive(folderPath, f.id),
        size: f.size ? Number(f.size) : 0,
        mtime: f.modifiedTime ? Date.parse(f.modifiedTime) : Date.now(),
        width: f.imageMediaMetadata?.width ?? null,
        height: f.imageMediaMetadata?.height ?? null,
      }));
  } catch (err) {
    console.error('driveFs.getImages failed:', err);
    return [];
  }
}

// get-subfolders → { subfolders: [{ name, path }], parentPath }
// Also returns `name` (this folder's own display name) — the local handler
// doesn't have it, but the renderer needs a label for drive:// breadcrumbs.
async function getSubfolders(auth, folderPath) {
  try {
    const items = await listCached(auth, driveId(folderPath));
    const subfolders = items
      .filter((f) => f.mimeType === driveApi.FOLDER_MIME)
      .map((f) => ({ 
        name: f.name, 
        path: joinDrive(folderPath, f.id),
        mtime: f.modifiedTime ? Date.parse(f.modifiedTime) : Date.now(),
      }));
    const name = await metaFor(auth, driveId(folderPath)).then((m) => m.name).catch(() => null);
    return { subfolders, parentPath: parentDrivePath(folderPath), name };
  } catch (err) {
    console.error('driveFs.getSubfolders failed:', err);
    return { subfolders: [], parentPath: null };
  }
}

// get-folder-preview → [{ name, path, dataUrl }]
async function getFolderPreview(auth, folderPath, limit = 4) {
  try {
    const items = await listCached(auth, driveId(folderPath));
    const images = items
      .filter((f) => f.mimeType !== driveApi.FOLDER_MIME && driveApi.isImage(f))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
      .slice(0, limit);
    return await Promise.all(images.map(async (f) => {
      const buf = await fetchThumbBuffer(auth, f.id, PREVIEW_THUMB_SIZE);
      return {
        name: f.name,
        path: joinDrive(folderPath, f.id),
        dataUrl: buf ? `data:${sniffMime(buf)};base64,${buf.toString('base64')}` : null,
      };
    }));
  } catch {
    return [];
  }
}

// get-image-data. 'full' (default) returns bare base64 of the real bytes,
// matching the local handler's shape. 'thumb' serves the Drive thumbnail as a
// complete data: URI — Drive chooses the thumbnail format independently of
// the file's extension, so the mime has to travel with the bytes.
async function getImageData(auth, imagePath, variant = 'full') {
  try {
    const fileId = driveId(imagePath);
    if (variant === 'thumb') {
      const buf = await fetchThumbBuffer(auth, fileId, THUMB_SIZE);
      if (buf) return `data:${sniffMime(buf)};base64,${buf.toString('base64')}`;
      // No thumbnail (rare) — fall through to full bytes.
    }
    const local = await materialize(auth, imagePath);
    const data = await fsp.readFile(local);
    return data.toString('base64');
  } catch (err) {
    console.error('driveFs.getImageData failed:', err);
    return null;
  }
}

// path-exists → boolean
async function pathExists(auth, p) {
  try {
    const meta = await metaFor(auth, driveId(p));
    return !meta.trashed;
  } catch {
    return false;
  }
}

// ── Write side ────────────────────────────────────────────────────

// rename-images(renames: [{ oldPath, newName }]) → { success }
async function renameImages(auth, renames) {
  let firstError = null;
  const jobs = renames.map(({ oldPath, newName }) => async () => {
    try {
      await driveApi.updateFile(auth, driveId(oldPath), { name: newName });
    } catch (err) {
      if (!firstError) firstError = err;
    }
  });
  await runPool(jobs, OP_CONCURRENCY);
  invalidate();
  return firstError ? { success: false, error: firstError.message } : { success: true };
}

// delete-images(filePaths) → { success }; progress { current, total }
async function deleteImages(auth, filePaths, onProgress) {
  const total = filePaths.length;
  let done = 0;
  let firstError = null;
  const jobs = filePaths.map((p) => async () => {
    try {
      await driveApi.trashFile(auth, driveId(p));
    } catch (err) {
      if (!firstError) firstError = err;
    }
    done += 1;
    onProgress?.({ current: done, total });
  });
  await runPool(jobs, OP_CONCURRENCY);
  invalidate();
  return firstError ? { success: false, error: firstError.message } : { success: true };
}

// Finder-style " (n)" suffix on name collision. `reserved` collects names
// already claimed earlier in the same batch so concurrent jobs don't pick
// the same suffix.
async function resolveDriveName(auth, parentId, name, reserved) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  const taken = async (candidate) => {
    if (reserved.has(candidate)) return true;
    const hit = await driveApi.findFileInFolder(auth, parentId, candidate);
    return !!hit;
  };
  let candidate = name;
  let n = 1;
  while (await taken(candidate)) {
    candidate = `${base} (${n})${ext}`;
    n += 1;
  }
  reserved.add(candidate);
  return candidate;
}

// move-images({ filePaths, destFolder }) → { success, moved, failed }
async function moveImages(auth, { filePaths, destFolder }, onProgress) {
  const destId = driveId(destFolder);
  const results = { moved: [], failed: [] };
  let done = 0;
  const reserved = new Set();
  const prepared = [];
  for (const src of filePaths) {
    try {
      const id = driveId(src);
      const meta = await metaFor(auth, id);
      const sameParent = (meta.parents || []).includes(destId);
      const finalName = sameParent
        ? meta.name
        : await resolveDriveName(auth, destId, meta.name, reserved);
      prepared.push({ src, id, meta, finalName });
    } catch (err) {
      results.failed.push({ path: src, error: err.message });
      done += 1;
      onProgress?.({ current: done, total: filePaths.length });
    }
  }
  const jobs = prepared.map(({ src, id, meta, finalName }) => async () => {
    try {
      const opts = {
        addParents: destId,
        removeParents: (meta.parents || []).join(','),
      };
      if (finalName !== meta.name) opts.name = finalName;
      await driveApi.updateFile(auth, id, opts);
      results.moved.push(src);
    } catch (err) {
      results.failed.push({ path: src, error: err.message });
    }
    done += 1;
    onProgress?.({ current: done, total: filePaths.length });
  });
  await runPool(jobs, OP_CONCURRENCY);
  invalidate();
  return { success: results.failed.length === 0, ...results };
}

// copy-images({ filePaths, destFolder }) → { success, copied, failed }
// Server-side files.copy — Drive duplicates the bytes itself.
async function copyImages(auth, { filePaths, destFolder }, onProgress) {
  const destId = driveId(destFolder);
  const results = { success: true, copied: [], failed: [] };
  let done = 0;
  const reserved = new Set();
  const prepared = [];
  for (const src of filePaths) {
    try {
      const meta = await metaFor(auth, driveId(src));
      const finalName = await resolveDriveName(auth, destId, meta.name, reserved);
      prepared.push({ src, finalName });
    } catch (err) {
      results.failed.push({ src, error: err.message });
      done += 1;
      onProgress?.({ current: done, total: filePaths.length });
    }
  }
  const jobs = prepared.map(({ src, finalName }) => async () => {
    try {
      const created = await driveApi.copyFile(auth, driveId(src), { parentId: destId, name: finalName });
      results.copied.push(joinDrive(destFolder, created.id));
    } catch (err) {
      results.failed.push({ src, error: err.message });
    }
    done += 1;
    onProgress?.({ current: done, total: filePaths.length });
  });
  await runPool(jobs, OP_CONCURRENCY);
  invalidate();
  if (results.failed.length > 0) results.success = false;
  return results;
}

// save-cropped-image({ originalPath, dataUrl }) → { success, path }
// Same format policy as the local handler: jpg stays jpg, everything else
// becomes png. The Drive fileId survives a media update, so the path is
// stable even when the name's extension changes.
async function saveCroppedImage(auth, { originalPath, dataUrl }) {
  try {
    const match = /^data:image\/(\w+);base64,(.+)$/s.exec(dataUrl || '');
    if (!match) return { success: false, error: 'Invalid image data' };
    const buffer = Buffer.from(match[2], 'base64');

    const fileId = driveId(originalPath);
    const meta = await metaFor(auth, fileId);
    const origExt = path.extname(meta.name || '');
    // Follow the format the renderer produced rather than forcing PNG, so a
    // cropped .webp stays a .webp instead of being replaced by a larger file.
    const ext = extForMime(match[1], origExt);
    const mimeType = `image/${match[1].toLowerCase()}`;
    const base = path.basename(meta.name || 'image', origExt);
    const newName = `${base}${ext}`;

    await driveApi.updateFile(auth, fileId, {
      buffer,
      mimeType,
      ...(newName !== meta.name ? { name: newName } : {}),
    });
    invalidate();
    // The pixels changed: this file's cached thumbnails are now stale.
    thumbLinkCache.delete(fileId);
    try {
      const dir = byteCacheDir();
      for (const n of await fsp.readdir(dir)) {
        if (n.startsWith(`${fileId}-`)) await fsp.unlink(path.join(dir, n)).catch(() => {});
      }
    } catch { /* cache dir may not exist */ }
    return { success: true, path: originalPath };
  } catch (error) {
    console.error('driveFs.saveCroppedImage failed:', error);
    return { success: false, error: error.message };
  }
}

// create-folder({ parentPath, name }) → { success, path }
async function createFolder(auth, { parentPath, name }) {
  try {
    const created = await driveApi.createFolder(auth, { parentId: driveId(parentPath), name });
    invalidate();
    return { success: true, path: joinDrive(parentPath, created.id) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// rename-folder({ oldPath, newName }) → { success, path } (path is id-based
// and therefore unchanged by a rename)
async function renameFolder(auth, { oldPath, newName }) {
  try {
    await driveApi.updateFile(auth, driveId(oldPath), { name: newName });
    invalidate();
    return { success: true, path: oldPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// delete-folder(folderPath) → { success }
async function deleteFolder(auth, folderPath) {
  try {
    await driveApi.trashFile(auth, driveId(folderPath));
    invalidate();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ── Watch: poll the folder and diff, emitting local-watcher-shaped
// changes ({ name, path, size, mtime, kind: 'change' | 'remove' }) ─

function snapshotOf(items) {
  const map = new Map();
  for (const f of items) {
    if (f.mimeType === driveApi.FOLDER_MIME || !driveApi.isImage(f)) continue;
    map.set(f.id, { name: f.name, size: f.size ? Number(f.size) : 0, modifiedTime: f.modifiedTime });
  }
  return map;
}

function watchFolder(auth, folderPath, onChanges, { intervalMs = 10000 } = {}) {
  const folderId = driveId(folderPath);
  let prev = null;
  let stopped = false;
  let inFlight = false;

  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      listingCache.delete(folderId); // force a fresh list for the diff
      const items = await listCached(auth, folderId);
      const next = snapshotOf(items);
      if (prev) {
        const changes = [];
        for (const [id, f] of next) {
          const old = prev.get(id);
          if (!old || old.name !== f.name || old.modifiedTime !== f.modifiedTime || old.size !== f.size) {
            changes.push({
              name: f.name,
              path: joinDrive(folderPath, id),
              size: f.size,
              mtime: f.modifiedTime ? Date.parse(f.modifiedTime) : Date.now(),
              kind: 'change',
            });
          }
        }
        for (const [id, f] of prev) {
          if (!next.has(id)) {
            changes.push({ name: f.name, path: joinDrive(folderPath, id), kind: 'remove' });
          }
        }
        if (changes.length && !stopped) onChanges(changes);
      }
      prev = next;
    } catch { /* transient network errors: keep polling */ }
    inFlight = false;
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

module.exports = {
  SCHEME,
  isDrivePath,
  driveId,
  joinDrive,
  parentDrivePath,
  invalidate,
  materialize,
  getImages,
  getSubfolders,
  getFolderPreview,
  getImageData,
  pathExists,
  renameImages,
  deleteImages,
  moveImages,
  copyImages,
  saveCroppedImage,
  createFolder,
  renameFolder,
  deleteFolder,
  watchFolder,
};
